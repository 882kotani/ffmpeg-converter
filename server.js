'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/* ============ 設定（環境変数で上書き可能） ============ */
const PORT = Number(process.env.PORT) || 10000;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT) || 3;
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 2048;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const DONE_TTL_MS = 10 * 60 * 1000;
const ERROR_TTL_MS = 5 * 60 * 1000;
const JOB_TIMEOUT_MS = 60 * 60 * 1000;
const TMP_DIR = path.join(__dirname, 'tmp');

const VIDEO = ['.mp4', '.mov', '.mxf'];
const AUDIO = ['.mp3', '.wav'];
const IMAGE = ['.jpg', '.jpeg', '.png'];

/* ============ 一時ディレクトリ ============ */
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const rm = (p) => {
	if (!p) return;
	try {
		fs.rmSync(p, { force: true });
	} catch (e) {
		/* 無視 */
	}
};

/* ============ ジョブキュー（インメモリ） ============ */
const jobs = new Map();
const queue = [];
let running = 0;

function pump() {
	while (running < MAX_CONCURRENT && queue.length > 0) {
		const job = jobs.get(queue.shift());
		if (job) run(job);
	}
}

function removeJob(job) {
	job.cancelled = true;
	if (job.proc) {
		try {
			job.proc.kill('SIGKILL');
		} catch (e) {
			/* 無視 */
		}
	}
	const i = queue.indexOf(job.id);
	if (i >= 0) queue.splice(i, 1);
	job.inputs.forEach((f) => rm(f.path));
	rm(job.outPath);
	jobs.delete(job.id);
}

function run(job) {
	job.status = 'processing';
	job.startedAt = Date.now();
	running += 1;
	(async () => {
		try {
			const planResult = await job.plan.build();
			const args = Array.isArray(planResult) ? planResult : planResult.args;
			job.totalDuration = (planResult && planResult.duration) || 0;
			job.outPath = path.join(TMP_DIR, `${job.id}-out${job.plan.ext}`);

			await new Promise((resolve, reject) => {
				const p = spawn(
					FFMPEG,
					['-hide_banner', '-nostdin', '-y', ...args, '-progress', 'pipe:1', job.outPath],
					{
						stdio: ['ignore', 'pipe', 'pipe'],
					},
				);
				job.proc = p;
				let err = '';

				let stdoutBuf = '';
				p.stdout.on('data', (d) => {
					stdoutBuf += d.toString();
					const lines = stdoutBuf.split('\n');
					stdoutBuf = lines.pop();
					for (const line of lines) {
						const [k, v] = line.split('=').map((s) => s.trim());
						if (!k || !v) continue;
						if (k === 'out_time_us') {
							const us = parseInt(v, 10);
							if (!isNaN(us)) {
								job.progress.currentTime = us / 1000000;
							}
						} else if (k === 'speed') {
							job.progress.speed = v;
							const m = v.match(/([\d.]+)x/);
							if (m) job.progress.speedNum = parseFloat(m[1]);
						}
					}
					if (job.totalDuration > 0 && job.progress.currentTime > 0) {
						const pct = Math.min(
							99,
							Math.max(0, Math.round((job.progress.currentTime / job.totalDuration) * 100)),
						);
						job.progress.percent = pct;
						if (job.progress.speedNum && job.progress.speedNum > 0) {
							const remainingSec =
								(job.totalDuration - job.progress.currentTime) / job.progress.speedNum;
							job.progress.etaSeconds = Math.max(0, Math.round(remainingSec));
						}
					}
				});

				p.stderr.on('data', (d) => {
					err = (err + d).slice(-2000);
				});
				p.on('error', (e) => reject(new Error('FFmpeg を起動できません: ' + e.message)));
				p.on('close', (code) => {
					if (code === 0) resolve();
					else reject(new Error('FFmpeg エラー: ' + lastLine(err)));
				});
			});

			if (!job.cancelled) {
				job.status = 'done';
				job.progress.percent = 100;
				job.progress.etaSeconds = 0;
				job.finishedAt = Date.now();
			}
		} catch (e) {
			if (!job.cancelled) {
				job.status = 'error';
				job.error = e.message;
				job.finishedAt = Date.now();
				rm(job.outPath);
			}
		} finally {
			job.proc = null;
			job.inputs.forEach((f) => rm(f.path));
			if (job.cancelled) rm(job.outPath);
			running -= 1;
			pump();
		}
	})();
}

function lastLine(text) {
	const line =
		String(text)
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter(Boolean)
			.pop() || '不明なエラー';
	return line.split(TMP_DIR).join('').slice(0, 300);
}

/* ============ FFmpeg / FFprobe ヘルパー ============ */
const CODEC = {
	'.mp4': {
		v: [
			'-c:v',
			'libx264',
			'-preset',
			'veryfast',
			'-pix_fmt',
			'yuv420p',
			'-color_primaries',
			'bt709',
			'-color_trc',
			'bt709',
			'-colorspace',
			'bt709',
		],
		vq: ['-crf', '20'],
		ac: ['-c:a', 'aac'],
		aq: ['-b:a', '192k'],
		tail: ['-movflags', '+faststart'],
	},
	'.mov': {
		v: [
			'-c:v',
			'libx264',
			'-preset',
			'veryfast',
			'-pix_fmt',
			'yuv420p',
			'-color_primaries',
			'bt709',
			'-color_trc',
			'bt709',
			'-colorspace',
			'bt709',
		],
		vq: ['-crf', '20'],
		ac: ['-c:a', 'aac'],
		aq: ['-b:a', '192k'],
		tail: [],
	},
	'.mxf': {
		v: ['-c:v', 'mpeg2video', '-pix_fmt', 'yuv422p'],
		vq: ['-b:v', '30M'],
		ac: ['-c:a', 'pcm_s16le', '-ar', '48000'],
		aq: [],
		tail: [],
	},
	'.mp3': { v: [], vq: [], ac: ['-c:a', 'libmp3lame'], aq: ['-q:a', '2'], tail: [] },
	'.wav': { v: [], vq: [], ac: ['-c:a', 'pcm_s16le'], aq: [], tail: [] },
};

function getColorArgs(info) {
	if (!info) return ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
	const invalid = ['unknown', 'reserved', 'unspecified'];
	const primaries =
		info.colorPrimaries && !invalid.includes(info.colorPrimaries) ? info.colorPrimaries : 'bt709';
	const trc =
		info.colorTransfer && !invalid.includes(info.colorTransfer) ? info.colorTransfer : 'bt709';
	const space = info.colorSpace && !invalid.includes(info.colorSpace) ? info.colorSpace : 'bt709';

	const args = ['-color_primaries', primaries, '-color_trc', trc, '-colorspace', space];
	if (info.colorRange && !invalid.includes(info.colorRange)) {
		args.push('-color_range', info.colorRange);
	}
	return args;
}

function enc(ext, o = {}) {
	const c = CODEC[ext] || CODEC['.mp4'];
	const r = [];
	if (AUDIO.includes(ext)) {
		r.push('-vn');
	} else if (o.vcopy) {
		r.push('-c:v', 'copy');
	} else {
		if (o.colorArgs && o.colorArgs.length > 0 && ext !== '.mxf') {
			r.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...o.colorArgs);
		} else {
			r.push(...c.v);
		}
		r.push(...(o.vb ? ['-b:v', o.vb] : c.vq));
	}
	r.push(...c.ac, ...(o.ab && c.aq.length ? ['-b:a', o.ab] : c.aq), ...c.tail);
	return r;
}

function runCapture(cmd, args) {
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		p.stdout.on('data', (d) => {
			out += d;
		});
		p.stderr.on('data', (d) => {
			err = (err + d).slice(-1000);
		});
		p.on('error', (e) => reject(new Error('ffprobe を起動できません: ' + e.message)));
		p.on('close', (code) =>
			code === 0 ? resolve(out) : reject(new Error('ffprobe エラー: ' + lastLine(err))),
		);
	});
}

async function getMediaInfo(file) {
	const out = await runCapture(FFPROBE, [
		'-v',
		'error',
		'-show_entries',
		'stream=codec_type,width,height,r_frame_rate,avg_frame_rate,bit_rate,duration,color_space,color_transfer,color_primaries,color_range:format=duration,bit_rate',
		'-of',
		'json',
		file,
	]);
	const j = JSON.parse(out);
	const v = (j.streams || []).find((s) => s.codec_type === 'video');
	const a = (j.streams || []).find((s) => s.codec_type === 'audio');

	let fps = null;
	if (v) {
		const rateStr =
			v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate;
		if (rateStr && rateStr.includes('/')) {
			const [num, den] = rateStr.split('/').map(Number);
			if (den > 0 && num > 0) {
				fps = Math.round((num / den) * 100) / 100;
			}
		}
	}

	let dur = parseFloat(j.format && j.format.duration);
	if (isNaN(dur) && v) dur = parseFloat(v.duration);
	if (isNaN(dur) && a) dur = parseFloat(a.duration);

	const formatBitrate =
		j.format && j.format.bit_rate ? Math.round(Number(j.format.bit_rate) / 1000) + 'k' : null;
	const videoBitrate = v && v.bit_rate ? Math.round(Number(v.bit_rate) / 1000) + 'k' : null;
	const audioBitrate = a && a.bit_rate ? Math.round(Number(a.bit_rate) / 1000) + 'k' : null;

	return {
		hasVideo: Boolean(v),
		hasAudio: Boolean(a),
		w: v ? v.width : null,
		h: v ? v.height : null,
		fps,
		videoBitrate,
		audioBitrate,
		formatBitrate,
		dur: isNaN(dur) ? 0 : dur,
		colorSpace: v ? v.color_space : null,
		colorTransfer: v ? v.color_transfer : null,
		colorPrimaries: v ? v.color_primaries : null,
		colorRange: v ? v.color_range : null,
	};
}

/* ============ 入力検証 + コマンド計画 ============ */
const reBitrate = /^\d{1,5}(\.\d+)?[kKmM]$/i;
const reDb = /^[+-]?\d{1,2}(\.\d+)?$/;
const reFps = /^\d{1,3}(\.\d+)?$/;

const kind = (i) =>
	VIDEO.includes(i.ext)
		? 'video'
		: AUDIO.includes(i.ext)
			? 'audio'
			: IMAGE.includes(i.ext)
				? 'image'
				: 'unknown';

function toSeconds(t) {
	if (typeof t === 'number') return t;
	const s = String(t || '').trim();
	if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
	const parts = s.split(':').map(Number);
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	return 0;
}

function makePlan(body, inputs) {
	const mode = String(body.mode || '');
	const need = (n, kinds) => {
		if (inputs.length !== n) throw new Error(`ファイルを${n}つ指定してください`);
		if (!inputs.every((i) => kinds.includes(kind(i))))
			throw new Error('このモードでは対応していないファイル形式が含まれています');
	};

	switch (mode) {
		case 'convert': {
			need(1, ['video', 'audio']);
			const ext = '.' + String(body.format || '').toLowerCase();
			if (!Object.prototype.hasOwnProperty.call(CODEC, ext)) throw new Error('出力形式が不正です');
			const i = inputs[0];
			if (kind(i) === 'audio' && VIDEO.includes(ext))
				throw new Error('音声ファイルを動画形式には変換できません');
			return {
				ext,
				suffix: '_converted',
				build: async () => {
					const info = await getMediaInfo(i.path);
					const colorArgs = kind(i) === 'video' ? getColorArgs(info) : [];
					return { args: ['-i', i.path, ...enc(ext, { colorArgs })], duration: info.dur };
				},
			};
		}
		case 'volume': {
			need(1, ['video', 'audio']);
			const db = String(body.db || '').trim();
			if (!reDb.test(db)) throw new Error('音量(dB)は -99〜+99 の数値で指定してください');
			const i = inputs[0];
			return {
				ext: i.ext,
				suffix: `_vol${db}dB`,
				build: async () => {
					const info = await getMediaInfo(i.path);
					return {
						args: ['-i', i.path, '-af', `volume=${Number(db)}dB`, ...enc(i.ext, { vcopy: true })],
						duration: info.dur,
					};
				},
			};
		}
		case 'bitrate': {
			need(1, ['video', 'audio']);
			const i = inputs[0];
			const vb = String(body.videoBitrate || '').trim();
			const ab = String(body.audioBitrate || '').trim();
			if (!vb && !ab) throw new Error('映像または音声のビットレートを指定してください');
			if ((vb && !reBitrate.test(vb)) || (ab && !reBitrate.test(ab)))
				throw new Error('ビットレートは 1000k / 320k のように指定してください');
			if (vb && kind(i) === 'audio')
				throw new Error('音声ファイルに映像ビットレートは指定できません');
			if (i.ext === '.wav') throw new Error('WAV は非圧縮のためビットレート変換できません');
			return {
				ext: i.ext,
				suffix: '_bitrate',
				build: async () => {
					const info = await getMediaInfo(i.path);
					const colorArgs = kind(i) === 'video' ? getColorArgs(info) : [];
					return { args: ['-i', i.path, ...enc(i.ext, { vb, ab, colorArgs })], duration: info.dur };
				},
			};
		}
		case 'fps': {
			need(1, ['video']);
			const fps = String(body.fps || '').trim();
			if (!reFps.test(fps) || Number(fps) < 1 || Number(fps) > 240)
				throw new Error('FPS は 1〜240 の数値で指定してください');
			const i = inputs[0];
			return {
				ext: i.ext,
				suffix: `_${fps}fps`,
				build: async () => {
					const info = await getMediaInfo(i.path);
					const colorArgs = getColorArgs(info);
					return {
						args: ['-i', i.path, '-vf', `fps=${Number(fps)}`, ...enc(i.ext, { colorArgs })],
						duration: info.dur,
					};
				},
			};
		}
		case 'resize': {
			need(1, ['video']);
			const W = { 1080: 1920, 1280: 1280, 720: 720 }[String(body.size)];
			if (!W) throw new Error('サイズは 1080 / 1280 / 720 から選択してください');
			const i = inputs[0];
			const vf = `scale=w='min(${W},trunc(iw/2)*2)':h=-2`;
			return {
				ext: i.ext,
				suffix: `_${body.size}`,
				build: async () => {
					const info = await getMediaInfo(i.path);
					const colorArgs = getColorArgs(info);
					return {
						args: ['-i', i.path, '-vf', vf, ...enc(i.ext, { colorArgs })],
						duration: info.dur,
					};
				},
			};
		}
		case 'concat': {
			if (inputs.length < 2 || !inputs.every((i) => kind(i) === 'video'))
				throw new Error('結合には動画ファイルを2本以上指定してください');
			return {
				ext: '.mp4',
				suffix: '_merged',
				build: async () => {
					const info = [];
					let totalDur = 0;
					for (const i of inputs) {
						const inf = await getMediaInfo(i.path);
						if (!inf.w || !inf.h) throw new Error('映像ストリームがないファイルが含まれています');
						info.push(inf);
						totalDur += inf.dur;
					}
					const W = Math.max(2, Math.floor(info[0].w / 2) * 2);
					const H = Math.max(2, Math.floor(info[0].h / 2) * 2);
					const parts = [];
					const labels = [];
					info.forEach((m, n) => {
						parts.push(
							`[${n}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${n}]`,
						);
						parts.push(
							m.hasAudio
								? `[${n}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${n}]`
								: `anullsrc=r=48000:cl=stereo:d=${m.dur.toFixed(
										3,
									)},aformat=sample_fmts=fltp[a${n}]`,
						);
						labels.push(`[v${n}][a${n}]`);
					});
					parts.push(`${labels.join('')}concat=n=${info.length}:v=1:a=1[v][a]`);
					const colorArgs = getColorArgs(info[0]);
					return {
						args: [
							...inputs.flatMap((i) => ['-i', i.path]),
							'-filter_complex',
							parts.join(';'),
							'-map',
							'[v]',
							'-map',
							'[a]',
							...enc('.mp4', { colorArgs }),
						],
						duration: totalDur,
					};
				},
			};
		}
		case 'still': {
			const au = inputs.filter((i) => kind(i) === 'audio');
			const im = inputs.filter((i) => kind(i) === 'image');
			if (inputs.length !== 2 || au.length !== 1 || im.length !== 1)
				throw new Error('音声ファイル1つと静止画1つを指定してください');
			return {
				ext: '.mp4',
				suffix: '_video',
				build: async () => {
					const aInfo = await getMediaInfo(au[0].path);
					// 音声の長さを秒数で取得し、末尾4秒超過を切り落とすため -t を明示的に設定
					const dur = aInfo.dur > 0 ? aInfo.dur.toFixed(3) : null;
					return {
						args: [
							'-loop',
							'1',
							'-framerate',
							'10',
							'-i',
							im[0].path,
							'-i',
							au[0].path,
							'-c:v',
							'libx264',
							'-tune',
							'stillimage',
							'-preset',
							'veryfast',
							'-pix_fmt',
							'yuv420p',
							'-color_primaries',
							'bt709',
							'-color_trc',
							'bt709',
							'-colorspace',
							'bt709',
							'-vf',
							'scale=trunc(iw/2)*2:trunc(ih/2)*2',
							'-c:a',
							'aac',
							'-b:a',
							'192k',
							...(dur ? ['-t', dur] : ['-shortest']),
							'-movflags',
							'+faststart',
						],
						duration: aInfo.dur,
					};
				},
			};
		}
		case 'cut': {
			need(1, ['video', 'audio']);
			const i = inputs[0];
			let ranges = [];
			try {
				ranges = typeof body.ranges === 'string' ? JSON.parse(body.ranges) : body.ranges || [];
			} catch (e) {
				ranges = [];
			}
			if (!Array.isArray(ranges) || ranges.length === 0) {
				const start = toSeconds(body.start || 0);
				const dur = toSeconds(body.duration || 30);
				ranges = [{ start, end: start + dur }];
			}

			ranges = ranges
				.map((r) => ({
					start: Math.max(0, toSeconds(r.start)),
					end: Math.max(0, toSeconds(r.end)),
				}))
				.filter((r) => r.end > r.start);

			if (!ranges.length) {
				throw new Error('切り出し範囲（開始時間・終了時間）を正しく指定してください');
			}

			const isVid = kind(i) === 'video';
			const ext = isVid ? '.mp4' : i.ext === '.wav' ? '.wav' : '.mp3';

			return {
				ext,
				suffix: '_cut',
				build: async () => {
					const info = await getMediaInfo(i.path);
					const colorArgs = isVid ? getColorArgs(info) : [];
					const totalCutDur = ranges.reduce((acc, r) => acc + (r.end - r.start), 0);

					if (ranges.length === 1) {
						const { start, end } = ranges[0];
						const dur = (end - start).toFixed(3);
						return {
							args: ['-ss', start.toFixed(3), '-i', i.path, '-t', dur, ...enc(ext, { colorArgs })],
							duration: parseFloat(dur),
						};
					}

					const parts = [];
					const labels = [];
					ranges.forEach((r, idx) => {
						const s = r.start.toFixed(3);
						const e = r.end.toFixed(3);
						if (isVid) {
							parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${idx}]`);
							if (info.hasAudio) {
								parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${idx}]`);
								labels.push(`[v${idx}][a${idx}]`);
							} else {
								labels.push(`[v${idx}]`);
							}
						} else {
							parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${idx}]`);
							labels.push(`[a${idx}]`);
						}
					});

					if (isVid) {
						if (info.hasAudio) {
							parts.push(`${labels.join('')}concat=n=${ranges.length}:v=1:a=1[v][a]`);
							return {
								args: [
									'-i',
									i.path,
									'-filter_complex',
									parts.join(';'),
									'-map',
									'[v]',
									'-map',
									'[a]',
									...enc(ext, { colorArgs }),
								],
								duration: totalCutDur,
							};
						}
						parts.push(`${labels.join('')}concat=n=${ranges.length}:v=1:a=0[v]`);
						return {
							args: ['-i', i.path, '-filter_complex', parts.join(';'), '-map', '[v]', ...enc(ext)],
							duration: totalCutDur,
						};
					}

					parts.push(`${labels.join('')}concat=n=${ranges.length}:v=0:a=1[a]`);
					return {
						args: ['-i', i.path, '-filter_complex', parts.join(';'), '-map', '[a]', ...enc(ext)],
						duration: totalCutDur,
					};
				},
			};
		}
		default:
			throw new Error('不明な機能です');
	}
}

/* ============ Express ============ */
const app = express();
app.disable('x-powered-by');

const upload = multer({
	storage: multer.diskStorage({
		destination: (req, file, cb) => cb(null, TMP_DIR),
		filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname).toLowerCase()),
	}),
	limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 50 },
	fileFilter: (req, file, cb) => {
		const ext = path.extname(file.originalname).toLowerCase();
		if ([...VIDEO, ...AUDIO, ...IMAGE].includes(ext)) cb(null, true);
		else cb(new Error(`未対応のファイル形式です: ${ext || '(拡張子なし)'}`));
	},
}).array('files', 50);

app.post('/api/probe', (req, res) => {
	upload(req, res, async (err) => {
		const files = req.files || [];
		if (err || files.length === 0) {
			files.forEach((f) => rm(f.path));
			return res.status(400).json({ error: 'ファイルの解析に失敗しました' });
		}
		const f = files[0];
		try {
			const info = await getMediaInfo(f.path);
			rm(f.path);
			res.json(info);
		} catch (e) {
			rm(f.path);
			res.status(400).json({ error: e.message });
		}
	});
});

app.post('/api/jobs', (req, res) => {
	upload(req, res, (err) => {
		const files = req.files || [];
		const discard = () => files.forEach((f) => rm(f.path));
		if (err) {
			discard();
			const tooBig = err.code === 'LIMIT_FILE_SIZE';
			return res.status(tooBig ? 413 : 400).json({
				error: tooBig ? `ファイルサイズの上限(${MAX_FILE_MB}MB)を超えています` : err.message,
			});
		}
		try {
			const inputs = files.map((f) => ({
				path: f.path,
				ext: path.extname(f.path).toLowerCase(),
				name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
			}));
			const plan = makePlan(req.body || {}, inputs);
			const main = inputs.find((i) => kind(i) !== 'image') || inputs[0];
			const base =
				path
					.basename(main.name, path.extname(main.name))
					.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
					.slice(0, 100) || 'output';
			const id = uuidv4();
			jobs.set(id, {
				id,
				status: 'queued',
				plan,
				inputs,
				outName: `${base}${plan.suffix}${plan.ext}`,
				outPath: null,
				error: null,
				proc: null,
				cancelled: false,
				totalDuration: 0,
				progress: { percent: 0, speed: null, speedNum: 0, etaSeconds: null, currentTime: 0 },
				createdAt: Date.now(),
				startedAt: null,
				finishedAt: null,
			});
			queue.push(id);
			res.status(202).json({ jobId: id });
			pump();
		} catch (e) {
			discard();
			res.status(400).json({ error: e.message });
		}
	});
});

app.get('/api/jobs/:id', (req, res) => {
	const job = jobs.get(req.params.id);
	if (!job) return res.status(404).json({ error: 'ジョブが見つかりません' });
	res.json({
		id: job.id,
		status: job.status,
		ahead: job.status === 'queued' ? queue.indexOf(job.id) : 0,
		waiting: queue.length,
		running,
		maxConcurrent: MAX_CONCURRENT,
		progress: job.progress,
		error: job.error,
		fileName: job.outName,
	});
});

app.get('/api/jobs/:id/download', (req, res) => {
	const job = jobs.get(req.params.id);
	if (!job || job.status !== 'done' || !job.outPath || !fs.existsSync(job.outPath)) {
		return res.status(404).json({ error: 'ダウンロードできるファイルがありません' });
	}
	res.download(job.outPath, job.outName, (err) => {
		if (!err) removeJob(job);
	});
});

app.delete('/api/jobs/:id', (req, res) => {
	const job = jobs.get(req.params.id);
	if (job) removeJob(job);
	res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

const BUILD_DIR = path.join(__dirname, 'build');
app.use(express.static(BUILD_DIR));
app.get('*', (req, res) => {
	const index = path.join(BUILD_DIR, 'index.html');
	if (fs.existsSync(index)) res.sendFile(index);
	else res.status(503).send('build フォルダがありません。`npm run build` を実行してください。');
});

/* ============ 定期掃除 ============ */
setInterval(() => {
	const now = Date.now();
	for (const job of Array.from(jobs.values())) {
		if (job.status === 'processing' && job.startedAt && now - job.startedAt > JOB_TIMEOUT_MS) {
			job.error = '処理がタイムアウトしました。ファイルが重すぎるか破損している可能性があります。';
			removeJob(job);
		}
		if (job.status === 'done' && now - job.finishedAt > DONE_TTL_MS) removeJob(job);
		if (job.status === 'error' && now - job.finishedAt > ERROR_TTL_MS) removeJob(job);
	}
}, 60 * 1000).unref();

/* ============ 起動・終了処理 ============ */
const server = app.listen(PORT, () => {
	console.log(
		`Server listening on http://localhost:${PORT} (max concurrent ffmpeg: ${MAX_CONCURRENT})`,
	);
});
server.requestTimeout = 0;
server.headersTimeout = 65 * 1000;

function shutdown() {
	for (const job of Array.from(jobs.values())) removeJob(job);
	fs.rmSync(TMP_DIR, { recursive: true, force: true });
	process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
