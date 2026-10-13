import React, { useState, useRef, useEffect } from 'react';
import './App.css';

const VIDEO_EXT = ['mp4', 'mov', 'mxf'];
const AUDIO_EXT = ['mp3', 'wav'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png'];
const POLL_MS = 1200;

const extOf = (name) => name.split('.').pop().toLowerCase();
const isAudio = (f) => AUDIO_EXT.includes(extOf(f.name));
const isImage = (f) => IMAGE_EXT.includes(extOf(f.name));

const MODES = [
	{
		id: 'convert',
		label: '形式変換',
		desc: 'MP4・MXF・MOV・MP3・WAV の間で相互にエンコード変換します。',
		accept: [...VIDEO_EXT, ...AUDIO_EXT],
		icon: (
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M7 16l-4-4m0 0l4-4m-4 4h18m-7 4l4 4m0 0l-4 4m4-4H3" />
			</svg>
		),
		specs: {
			title: 'ファイル形式変換（相互変換）',
			changes: [
				'コンテナフォーマット（MP4 / MOV / MXF / MP3 / WAV）',
				'映像コーデック（MP4/MOV: H.264 libx264, MXF: MPEG-2 mpeg2video）',
				'音声コーデック（MP4/MOV: AAC, MXF/WAV: PCM 16bit, MP3: libmp3lame）',
				'色空間メタデータ（BT.709 VUIタグの最適化付与）',
			],
			keeps: [
				'解像度・アスペクト比（元のピクセルサイズを保持）',
				'フレームレート（元のfpsを保持）',
				'音声チャンネル数・サンプリング周波数（MXF/WAV規格準拠時を除く）',
			],
			command:
				'ffmpeg -i input.mov \\\n  -c:v libx264 -preset veryfast -pix_fmt yuv420p \\\n  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \\\n  -crf 20 \\\n  -c:a aac -b:a 192k \\\n  -movflags +faststart output.mp4',
			details:
				'MP4/MOVはWeb標準のH.264 (yuv420p) + AACで再エンコード。MXFは業務用仕様のMPEG-2 (yuv422p, 30Mbps) + リニアPCM 48kHz。MOVからMP4への変換時にもQuickTimeガンマシフトを防ぐBT.709メタデータを注入します。',
		},
	},
	{
		id: 'volume',
		label: '音量調整',
		desc: '音量を dB 単位で調整します。映像トラックはそのまま高速保持されます。',
		accept: [...VIDEO_EXT, ...AUDIO_EXT],
		icon: (
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
				<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
				<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
			</svg>
		),
		specs: {
			title: '音量レベル変換（dB調整）',
			changes: [
				'音声ゲイン（指定したdB値による増減）',
				'音声トラックの再エンコード（AAC / MP3 / PCM）',
			],
			keeps: [
				'映像トラック全体（-c:v copy による完全無劣化・超高速ストリームコピー）',
				'解像度・フレームレート・色空間・ビットレート',
				'コンテナ形式・タイムスタンプ',
			],
			command:
				'ffmpeg -i input.mp4 \\\n  -af "volume=3dB" \\\n  -c:v copy \\\n  -c:a aac -b:a 192k \\\n  -movflags +faststart output.mp4',
			details:
				'FFmpegの volume オーディオフィルタを適用。動画ファイルの場合、映像部分は再エンコードを一切行わない「-c:v copy」を指定するため、画質劣化ゼロかつ数秒で処理が完了します。',
		},
	},
	{
		id: 'bitrate',
		label: 'ビットレート変更',
		desc: '映像・音声のビットレートを指定して再エンコードし、ファイルサイズや品質を最適化します。',
		accept: [...VIDEO_EXT, ...AUDIO_EXT],
		icon: (
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
				<rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
				<line x1="6" y1="6" x2="6.01" y2="6" />
				<line x1="6" y1="18" x2="6.01" y2="18" />
			</svg>
		),
		specs: {
			title: 'ビットレート変換（データレート指定）',
			changes: [
				'映像ビットレート（-b:v 指定値で再圧縮）',
				'音声ビットレート（-b:a 指定値で再圧縮）',
				'ファイル全体の容量（データサイズ）',
			],
			keeps: ['画面解像度（幅・高さ）', 'フレームレート（fps）', 'カラープロファイル・色空間'],
			command:
				'ffmpeg -i input.mp4 \\\n  -c:v libx264 -preset veryfast -pix_fmt yuv420p \\\n  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \\\n  -b:v 1000k \\\n  -c:a aac -b:a 128k output.mp4',
			details:
				'指定したビットレート（例: 映像1000k、音声128k）を目標値としてエンコードします。現在の元ファイルビットレートが事前解析されてUIに表示されるため、狙った圧縮率を正確に指定できます。',
		},
	},
	{
		id: 'fps',
		label: 'フレームレート変更',
		desc: '動画の再生フレームレート（fps）を変更します。',
		accept: VIDEO_EXT,
		icon: (
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
		),
		specs: {
			title: 'フレームレート変換（FPS調整）',
			changes: [
				'1秒あたりのコマ数（fps=N フィルタで間引きまたはフレーム補間複製）',
				'映像ストリームの再エンコード',
			],
			keeps: [
				'動画の再生速度・実時間（等速再生を維持）',
				'画面解像度・アスペクト比',
				'音声トラック（音ズレなし）',
			],
			command:
				'ffmpeg -i input.mp4 \\\n  -vf "fps=60" \\\n  -c:v libx264 -preset veryfast -pix_fmt yuv420p \\\n  -crf 20 -c:a aac -b:a 192k output.mp4',
			details:
				'FFmpegの fps ビデオフィルタを使用。タイムスタンプを再計算しながらコマ数を厳密に目的のレート（例: 24, 30, 60）に整えます。再生速度が変わってしまうことはありません。',
		},
	},
	{
		id: 'resize',
		label: 'リサイズ',
		desc: '縦横比を維持しながら指定幅に収まるよう縮小し、偶数ピクセル制約を満たして変換します。',
		accept: VIDEO_EXT,
		icon: (
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M15 3h6v6" />
				<path d="M9 21H3v-6" />
				<path d="M21 3l-7 7" />
				<path d="M3 21l7-7" />
			</svg>
		),
		specs: {
			title: 'リサイズ（アスペクト比維持スケール）',
			changes: [
				'画面解像度（横幅上限 1920/1280/720 に合わせた縮小）',
				'縦ピクセル数（H.264仕様を満たす偶数ピクセル自動調整）',
			],
			keeps: [
				'アスペクト比（映像が引き伸ばされたり歪むことはありません）',
				'フレームレート（元のfpsを保持）',
				'音声トラック',
			],
			command:
				'ffmpeg -i input.mp4 \\\n  -vf "scale=w=\'min(1280,trunc(iw/2)*2)\':h=-2" \\\n  -c:v libx264 -preset veryfast -pix_fmt yuv420p \\\n  -crf 20 -c:a aac -b:a 192k output.mp4',
			details:
				"「scale=w='min(W,trunc(iw/2)*2)':h=-2」フィルタを適用。元サイズが指定幅より小さい場合は拡大せず保持し、縦幅は「-2」によりアスペクト比を維持しつつH.264エンコードエラーを防ぐ偶数ピクセルへ揃えます。",
		},
	},
	{
		id: 'rotate',
		label: '回転',
		desc: '動画の向きを 90度・180度・270度 時計回りに回転します。',
		accept: VIDEO_EXT,
		icon: (
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
			</svg>
		),
		specs: {
			title: '動画回転（時計回り 90° / 180° / 270°）',
			changes: [
				'映像ピクセルの物理配置（90°/270°は縦横幅が入れ替わります）',
				'回転メタデータの初期化（-metadata:s:v:0 rotate=0 で二重回転を防止）',
			],
			keeps: ['音声トラック', 'アスペクト比（正方形ピクセルを維持）', 'フレームレート'],
			command:
				'ffmpeg -i input.mp4 \\\n  -vf "transpose=1,scale=trunc(iw/2)*2:trunc(ih/2)*2" \\\n  -metadata:s:v:0 rotate=0 \\\n  -c:v libx264 -preset veryfast -pix_fmt yuv420p \\\n  -crf 20 -c:a aac -b:a 192k output.mp4',
			details:
				'90度は transpose=1、180度は transpose=1,transpose=1、270度は transpose=2 を適用。スマートフォンの動画に付与されている回転メタデータタグをクリアし、ピクセルそのものを物理的に回転させて再エンコードします。',
		},
	},
	{
		id: 'concat',
		label: '動画結合',
		desc: '複数の動画をドラッグ＆ドロップで並び替えて連結し、統一した1本の MP4 を生成します。',
		accept: VIDEO_EXT,
		multi: true,
		icon: (
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<rect x="2" y="4" width="8" height="16" rx="2" />
				<rect x="14" y="4" width="8" height="16" rx="2" />
				<path d="M10 12h4" />
			</svg>
		),
		specs: {
			title: '複数動画の結合（正規化連結）',
			changes: [
				'解像度・黒帯余白（1本目の動画サイズに揃えて自動パディング）',
				'フレームレート（30fpsに統一）',
				'音声仕様（48kHz / 16bit / ステレオに正規化。無音動画には無音トラックを自動補完）',
				'出力コンテナ（MP4に統一）',
			],
			keeps: [
				'各動画の内容と指定した順番（ドラッグ＆ドロップ順）',
				'各動画のアスペクト比（レターボックス/ピラーボックス付与）',
			],
			command:
				'ffmpeg -i in1.mp4 -i in2.mp4 \\\n  -filter_complex \\\n  "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v0];\\\n   [0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];\\\n   [1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v1];\\\n   [1:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a1];\\\n   [v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \\\n  -map "[v]" -map "[a]" -c:v libx264 -c:a aac output.mp4',
			details:
				'解像度やfps、音声仕様が異なる動画同士でも失敗せずに結合できるよう、高度なフィルタコンプレックスで1本目の解像度・30fps・48kHzステレオに自動正規化してから連結します。',
		},
	},
	{
		id: 'still',
		label: '静止画＋音声から MP4',
		desc: '音声の長さにぴったり合わせて静止画を表示し続ける MP4 を生成します。',
		accept: [...AUDIO_EXT, ...IMAGE_EXT],
		icon: (
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
				<circle cx="8.5" cy="8.5" r="1.5" />
				<polyline points="21 15 16 10 5 21" />
			</svg>
		),
		specs: {
			title: '静止画＋音声 → MP4生成',
			changes: [
				'静止画の映像ストリーム化（H.264 静止画特化 -tune stillimage）',
				'出力ファイル長（音声の長さに合わせて -t で末尾余分な4秒超過をカット）',
			],
			keeps: ['音声トラックの内容・音質（AAC 192kbps）', '静止画の鮮明度・アスペクト比'],
			command:
				'ffmpeg -loop 1 -framerate 10 -i image.png -i audio.mp3 \\\n  -c:v libx264 -tune stillimage -preset veryfast -pix_fmt yuv420p \\\n  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \\\n  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \\\n  -c:a aac -b:a 192k \\\n  -t 182.500 \\\n  -movflags +faststart output.mp4',
			details:
				'-tune stillimage を指定して静止画に最適化した高効率エンコードを行います。FFmpeg特有のバッファ超過（音声より動画が4秒長くなる現象）を防止するため、事前に音声長を解析して -t で正確に揃えて出力します。',
		},
	},
	{
		id: 'cut',
		label: '動画・音声の切り出し',
		desc: 'プレビュー再生を見ながら「START」「STOP」で範囲を指定。複数区間の自動結合・再エンコードに対応します。',
		accept: [...VIDEO_EXT, ...AUDIO_EXT],
		icon: (
			<svg
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<circle cx="6" cy="6" r="3" />
				<circle cx="6" cy="18" r="3" />
				<line x1="20" y1="4" x2="8.12" y2="15.88" />
				<line x1="14.47" y1="14.48" x2="20" y2="20" />
				<line x1="8.12" y1="8.12" x2="12" y2="12" />
			</svg>
		),
		specs: {
			title: '動画・音声の切り出し（トリミング＆複数区間結合）',
			changes: [
				'ファイルの再生時間（指定した開始〜終了区間のみ抽出）',
				'複数区間指定時のシームレス連結（再エンコード）',
			],
			keeps: [
				'映像・音声の解像度・アスペクト比・サンプリングレート',
				'カラープロファイル・色空間メタデータ',
			],
			command:
				'# 単一区間の場合:\nffmpeg -ss 00:05.0 -i input.mp4 -t 15.000 \\\n  -c:v libx264 -preset veryfast -pix_fmt yuv420p \\\n  -crf 20 -c:a aac -b:a 192k output.mp4\n\n# 複数区間の場合は trim/atrim フィルタで抽出し結合再エンコード',
			details:
				'プレビュー再生位置に合わせて START / STOP をワンクリックするだけで区間を指定可能。複数区間を指定した場合は、FFmpegの trim フィルタと concat フィルタを用いてズレなく連結し、1本のファイルに出力します。',
		},
	},
];

const INITIAL_PARAMS = {
	format: 'mp4',
	db: '3',
	videoBitrate: '1000k',
	audioBitrate: '128k',
	fps: '30',
	size: '1280',
	angle: '90',
};

const formatSize = (b) => {
	if (b >= 1073741824) return `${(b / 1073741824).toFixed(2)} GB`;
	if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(b / 1024))} KB`;
};

function secToHms(sec) {
	const s = Math.max(0, Number(sec) || 0);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const rest = (s % 60).toFixed(1);
	const pad = (n) => String(n).padStart(2, '0');
	return h > 0 ? `${pad(h)}:${pad(m)}:${pad(rest)}` : `${pad(m)}:${pad(rest)}`;
}

function parseTimeToSec(t) {
	const str = String(t || '').trim();
	if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
	const parts = str.split(':').map(Number);
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	return 0;
}

function formatEta(sec) {
	if (sec == null) return '';
	if (sec >= 60) {
		const m = Math.floor(sec / 60);
		const s = sec % 60;
		return `${m}分${s > 0 ? `${s}秒` : ''}`;
	}
	return `${sec}秒`;
}

function uploadJob(formData, onProgress) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/jobs');
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
		};
		xhr.onload = () => {
			let body = {};
			try {
				body = JSON.parse(xhr.responseText);
			} catch (e) {
				/* 無視 */
			}
			if (xhr.status >= 200 && xhr.status < 300) resolve(body);
			else reject(new Error(body.error || `アップロードに失敗しました (${xhr.status})`));
		};
		xhr.onerror = () => reject(new Error('ネットワークエラーが発生しました'));
		xhr.send(formData);
	});
}

function triggerDownload(jobId) {
	const a = document.createElement('a');
	a.href = `/api/jobs/${jobId}/download`;
	a.rel = 'noopener';
	a.download = '';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

function Field({ label, hint, children }) {
	return (
		<label className="field">
			<span className="field-label">{label}</span>
			{children}
			{hint && <span className="field-hint">{hint}</span>}
		</label>
	);
}

export default function App() {
	const [modeId, setModeId] = useState('convert');
	const [files, setFiles] = useState([]);
	const [p, setP] = useState(INITIAL_PARAMS);
	const [phase, setPhase] = useState('idle');
	const [progress, setProgress] = useState(0);
	const [jobId, setJobId] = useState(null);
	const [job, setJob] = useState(null);
	const [message, setMessage] = useState('');
	const [notice, setNotice] = useState('');
	const [dragOver, setDragOver] = useState(false);

	const [mediaInfo, setMediaInfo] = useState(null);
	const [probing, setProbing] = useState(false);

	const [previewUrl, setPreviewUrl] = useState(null);
	const [ranges, setRanges] = useState([{ id: 1, start: '00:00.0', end: '00:10.0' }]);
	const [dragItemIndex, setDragItemIndex] = useState(null);

	// 諸元モーダル用ステート
	const [specModalMode, setSpecModalMode] = useState(null);

	const inputRef = useRef(null);
	const mediaRef = useRef(null);
	const downloadedRef = useRef(null);

	const mode = MODES.find((m) => m.id === modeId);
	const busy = phase === 'uploading' || phase === 'running';
	const setParam = (key) => (e) => setP((prev) => ({ ...prev, [key]: e.target.value }));

	// ESCキーでモーダルを閉じる
	useEffect(() => {
		const handleKeyDown = (e) => {
			if (e.key === 'Escape') setSpecModalMode(null);
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, []);

	useEffect(() => {
		if (files.length === 0) {
			if (previewUrl) URL.revokeObjectURL(previewUrl);
			setPreviewUrl(null);
			setMediaInfo(null);
			return;
		}

		// 静止画+音声モードの場合は音声ファイルのみをメタデータ解析の対象にする
		const targetFile = modeId === 'still' ? files.find(isAudio) : files[0];

		// プレビュー表示用URL（静止画モード時は音声を優先、なければ画像）
		const displayFile = modeId === 'still' ? files.find(isAudio) || files[0] : files[0];

		const url = URL.createObjectURL(displayFile);
		setPreviewUrl(url);

		// 解析対象がない（画像のみドロップされている状態）なら通信をスキップ
		if (!targetFile || isImage(targetFile)) {
			setMediaInfo(null);
			setProbing(false);
			return () => {
				URL.revokeObjectURL(url);
			};
		}

		setProbing(true);
		const fd = new FormData();
		fd.append('files', targetFile);
		fetch('/api/probe', { method: 'POST', body: fd })
			.then((res) => (res.ok ? res.json() : null))
			.then((data) => {
				if (data) {
					setMediaInfo(data);
					if (modeId === 'cut' && data.dur > 0) {
						setRanges([{ id: 1, start: '00:00.0', end: secToHms(Math.min(10, data.dur)) }]);
					}
				}
			})
			.catch(() => {})
			.finally(() => setProbing(false));

		return () => {
			URL.revokeObjectURL(url);
		};
	}, [files, modeId]);

	useEffect(() => {
		if (!jobId) return undefined;
		let stopped = false;
		const tick = async () => {
			try {
				const res = await fetch(`/api/jobs/${jobId}`);
				if (stopped) return;
				if (res.status === 404) {
					stopped = true;
					setMessage('ジョブが見つかりません。時間切れか、サーバーが再起動した可能性があります。');
					setPhase('error');
					return;
				}
				const data = await res.json();
				if (stopped) return;
				setJob(data);
				if (data.status === 'done') {
					stopped = true;
					if (downloadedRef.current !== jobId) {
						downloadedRef.current = jobId;
						triggerDownload(jobId);
					}
					setPhase('done');
				} else if (data.status === 'error') {
					stopped = true;
					setMessage(data.error || '変換に失敗しました');
					setPhase('error');
				}
			} catch (e) {
				/* 再試行 */
			}
		};
		tick();
		const timer = setInterval(() => {
			if (!stopped) tick();
		}, POLL_MS);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}, [jobId]);

	const reset = (clearFiles) => {
		setJobId(null);
		setJob(null);
		setPhase('idle');
		setMessage('');
		setNotice('');
		setProgress(0);
		downloadedRef.current = null;
		if (clearFiles) {
			setFiles([]);
			setRanges([{ id: 1, start: '00:00.0', end: '00:10.0' }]);
		}
	};

	const changeMode = (id) => {
		if (busy || id === modeId) return;
		setModeId(id);
		reset(true);
	};

	const addFiles = (list) => {
		const all = Array.from(list);
		const incoming = all.filter((f) => mode.accept.includes(extOf(f.name)));
		setNotice(
			incoming.length < all.length
				? `このモードで使える形式: ${mode.accept.join(' / ').toUpperCase()}`
				: '',
		);
		if (!incoming.length) return;
		if (phase === 'done' || phase === 'error') reset(false);

		if (mode.id === 'concat') {
			setFiles((prev) => [...prev, ...incoming]);
		} else if (mode.id === 'still') {
			setFiles((prev) => {
				let audio = prev.find(isAudio);
				let image = prev.find(isImage);
				incoming.forEach((f) => {
					if (isAudio(f)) audio = f;
					else image = f;
				});
				return [audio, image].filter(Boolean);
			});
		} else {
			setFiles([incoming[0]]);
		}
	};

	const onDrop = (e) => {
		e.preventDefault();
		setDragOver(false);
		if (!busy) addFiles(e.dataTransfer.files);
	};

	const removeFile = (index) => {
		setFiles((prev) => prev.filter((_, i) => i !== index));
		setNotice('');
	};

	const moveFile = (index, dir) =>
		setFiles((prev) => {
			const next = prev.slice();
			const to = index + dir;
			if (to < 0 || to >= next.length) return prev;
			[next[index], next[to]] = [next[to], next[index]];
			return next;
		});

	const handleItemDragStart = (e, index) => {
		setDragItemIndex(index);
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleItemDrop = (e, dropIndex) => {
		e.preventDefault();
		if (dragItemIndex === null || dragItemIndex === dropIndex) return;
		setFiles((prev) => {
			const updated = [...prev];
			const [moved] = updated.splice(dragItemIndex, 1);
			updated.splice(dropIndex, 0, moved);
			return updated;
		});
		setDragItemIndex(null);
	};

	const addRange = () => {
		const cur = mediaRef.current ? mediaRef.current.currentTime : 0;
		const nextStart = secToHms(cur);
		const nextEnd = secToHms(cur + 10);
		setRanges((prev) => [...prev, { id: Date.now(), start: nextStart, end: nextEnd }]);
	};

	const removeRange = (id) => {
		if (ranges.length <= 1) return;
		setRanges((prev) => prev.filter((r) => r.id !== id));
	};

	const updateRange = (id, key, val) => {
		setRanges((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: val } : r)));
	};

	const markCurrentTime = (id, field) => {
		if (!mediaRef.current) return;
		const cur = secToHms(mediaRef.current.currentTime);
		updateRange(id, field, cur);
	};

	const playRange = (startStr) => {
		if (!mediaRef.current) return;
		const s = parseTimeToSec(startStr);
		mediaRef.current.currentTime = s;
		mediaRef.current.play();
	};

	const validate = () => {
		if (mode.id === 'concat') return files.length < 2 ? '動画を2本以上追加してください' : '';
		if (mode.id === 'still')
			return files.some(isAudio) && files.some(isImage)
				? ''
				: '音声ファイルと静止画を1つずつ追加してください';
		if (!files.length) return 'ファイルを追加してください';

		if (mode.id === 'volume' && !/^[+-]?\d{1,2}(\.\d+)?$/.test(p.db.trim()))
			return '音量は数値で入力してください（例: +3、-6）';
		if (mode.id === 'bitrate') {
			const v = p.videoBitrate.trim();
			const a = p.audioBitrate.trim();
			if (!v && !a) return 'ビットレートを1つ以上入力してください';
			if (v && !/^\d{1,5}(\.\d+)?[kKmM]$/i.test(v))
				return '映像ビットレートは 1000k や 5M の形式で入力してください';
			if (a && !/^\d{1,5}(\.\d+)?[kKmM]$/i.test(a))
				return '音声ビットレートは 128k や 320k の形式で入力してください';
		}
		if (mode.id === 'fps' && !(Number(p.fps) >= 1 && Number(p.fps) <= 240))
			return 'FPS は 1〜240 の数値で入力してください';
		if (mode.id === 'rotate' && !['90', '180', '270'].includes(p.angle))
			return '回転角度を選択してください';

		if (mode.id === 'cut') {
			for (let i = 0; i < ranges.length; i++) {
				const s = parseTimeToSec(ranges[i].start);
				const e = parseTimeToSec(ranges[i].end);
				if (e <= s) return `範囲 #${i + 1} の終了時間は開始時間より後に設定してください`;
			}
		}
		return '';
	};

	const submit = async () => {
		const problem = validate();
		if (problem) {
			setNotice(problem);
			return;
		}
		setNotice('');
		setMessage('');
		setJob(null);
		setProgress(0);
		setPhase('uploading');

		const fd = new FormData();
		fd.append('mode', mode.id);
		['format', 'db', 'videoBitrate', 'audioBitrate', 'fps', 'size', 'angle'].forEach((k) =>
			fd.append(k, p[k]),
		);

		if (mode.id === 'cut') {
			fd.append('ranges', JSON.stringify(ranges));
		}

		files.forEach((f) => fd.append('files', f));

		try {
			const res = await uploadJob(fd, setProgress);
			setJobId(res.jobId);
			setPhase('running');
		} catch (e) {
			setMessage(e.message);
			setPhase('error');
		}
	};

	const cancel = async () => {
		if (jobId) {
			try {
				await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
			} catch (e) {
				/* 無視 */
			}
		}
		reset(false);
	};

	const renderParams = () => {
		const onlyAudio = files.length > 0 && files.every(isAudio);

		switch (mode.id) {
			case 'convert':
				return (
					<Field
						label="変換後の形式"
						hint="MP4・MOV: H.264 / AAC、MXF: MPEG-2 / PCM、MP3、WAV: PCM 16bit"
					>
						<select value={p.format} onChange={setParam('format')} disabled={busy}>
							<option value="mp4">MP4（H.264 / AAC）</option>
							<option value="mov">MOV（H.264 / AAC）</option>
							<option value="mxf">MXF（MPEG-2 / PCM）</option>
							<option value="mp3">MP3（libmp3lame）</option>
							<option value="wav">WAV（非圧縮 PCM 16bit）</option>
						</select>
					</Field>
				);
			case 'volume':
				return (
					<Field
						label="音量の増減値（dB）"
						hint="例: +3 で大きく、-6 で小さく設定（映像は無劣化コピー）"
					>
						<div className="input-with-unit">
							<input
								type="text"
								inputMode="decimal"
								value={p.db}
								onChange={setParam('db')}
								disabled={busy}
								placeholder="+3 または -6"
							/>
							<span className="unit-label">dB</span>
						</div>
					</Field>
				);
			case 'bitrate':
				return (
					<div className="param-block">
						{mediaInfo && (
							<div className="meta-badge" role="status">
								<span className="meta-badge-title">解析された現在値:</span>
								{mediaInfo.videoBitrate && (
									<span className="meta-pill">
										映像 <strong>{mediaInfo.videoBitrate}</strong>
									</span>
								)}
								{mediaInfo.audioBitrate && (
									<span className="meta-pill">
										音声 <strong>{mediaInfo.audioBitrate}</strong>
									</span>
								)}
								{!mediaInfo.videoBitrate && mediaInfo.formatBitrate && (
									<span className="meta-pill">
										全体 <strong>{mediaInfo.formatBitrate}</strong>
									</span>
								)}
							</div>
						)}
						<div className="field-row">
							<Field label="映像ビットレート" hint="例: 1000k、5M（動画のみ有効）">
								<input
									type="text"
									value={p.videoBitrate}
									onChange={setParam('videoBitrate')}
									disabled={busy || onlyAudio}
									placeholder="1000k"
								/>
							</Field>
							<Field label="音声ビットレート" hint="例: 128k、320k（WAVは対象外）">
								<input
									type="text"
									value={p.audioBitrate}
									onChange={setParam('audioBitrate')}
									disabled={busy}
									placeholder="128k"
								/>
							</Field>
						</div>
					</div>
				);
			case 'fps':
				return (
					<div className="param-block">
						{mediaInfo && mediaInfo.fps && (
							<div className="meta-badge" role="status">
								<span className="meta-badge-title">現在のフレームレート:</span>
								<span className="meta-pill">
									<strong>{mediaInfo.fps} fps</strong>
								</span>
							</div>
						)}
						<Field label="目的のフレームレート（fps）" hint="例: 24、30、60">
							<div className="input-with-unit">
								<input
									type="number"
									min="1"
									max="240"
									step="any"
									value={p.fps}
									onChange={setParam('fps')}
									disabled={busy}
								/>
								<span className="unit-label">fps</span>
							</div>
						</Field>
					</div>
				);
			case 'resize':
				return (
					<div className="param-block">
						{mediaInfo && mediaInfo.w && (
							<div className="meta-badge" role="status">
								<span className="meta-badge-title">現在の画面解像度:</span>
								<span className="meta-pill">
									<strong>
										{mediaInfo.w} × {mediaInfo.h}
									</strong>
								</span>
							</div>
						)}
						<Field
							label="リサイズ寸法"
							hint="アスペクト比を維持し、H.264の偶数ピクセル制約を満たします"
						>
							<select value={p.size} onChange={setParam('size')} disabled={busy}>
								<option value="1080">フルHD 1080p（横 1920px 以内）</option>
								<option value="1280">HD 720p 相当（横 1280px 以内）</option>
								<option value="720">コンパクト（横 720px 以内）</option>
							</select>
						</Field>
					</div>
				);
			case 'rotate':
				return (
					<div className="rotate-section">
						{previewUrl && (
							<div className="preview-container rotate-preview-container">
								<div className="preview-header">
									<span className="field-label">回転プレビュー</span>
									<span className="field-hint">選択した角度の向きがリアルタイムで反映されます</span>
								</div>
								<div className="video-wrapper rotate-wrapper">
									<video
										ref={mediaRef}
										src={previewUrl}
										controls
										className="preview-media"
										style={{
											transform: `rotate(${p.angle}deg)`,
											transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
										}}
									/>
								</div>
							</div>
						)}
						<Field label="回転角度（時計回り）" hint="90度・180度・270度から選択してください">
							<select value={p.angle} onChange={setParam('angle')} disabled={busy}>
								<option value="90">90° 時計回り</option>
								<option value="180">180° 反転</option>
								<option value="270">270° 時計回り（90° 反時計回り）</option>
							</select>
						</Field>
					</div>
				);
			case 'cut':
				return (
					<div className="cut-section">
						{previewUrl && (
							<div className="preview-container">
								<div className="preview-header">
									<span className="field-label">メディアプレビュー</span>
									<span className="field-hint">
										再生位置に合わせて START / STOP を押すと現在時刻がセットされます
									</span>
								</div>
								{files[0] && isAudio(files[0]) ? (
									<audio
										ref={mediaRef}
										src={previewUrl}
										controls
										className="preview-media is-audio"
									/>
								) : (
									<div className="video-wrapper">
										<video ref={mediaRef} src={previewUrl} controls className="preview-media" />
									</div>
								)}
							</div>
						)}

						<div className="cut-ranges">
							<div className="cut-header">
								<div>
									<span className="field-label">切り出し範囲設定</span>
									<span className="field-hint">各区間の開始・終了時刻を指定してください</span>
								</div>
								<button
									type="button"
									className="btn-secondary btn-sm"
									onClick={addRange}
									disabled={busy}
								>
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.5"
									>
										<line x1="12" y1="5" x2="12" y2="19" />
										<line x1="5" y1="12" x2="19" y2="12" />
									</svg>
									範囲を追加
								</button>
							</div>

							<div className="range-list">
								{ranges.map((r, idx) => (
									<div key={r.id} className="cut-range-card">
										<div className="range-badge">区間 #{idx + 1}</div>

										<div className="range-controls-row">
											<div className="range-field">
												<span className="range-sublabel">開始</span>
												<div className="range-input-group">
													<input
														type="text"
														className="time-input"
														value={r.start}
														onChange={(e) => updateRange(r.id, 'start', e.target.value)}
														disabled={busy}
													/>
													<button
														type="button"
														className="btn-mark btn-start"
														onClick={() => markCurrentTime(r.id, 'start')}
														disabled={busy || !previewUrl}
														title="動画・音声の現在再生位置を開始時刻にセット"
													>
														START
													</button>
												</div>
											</div>

											<div className="range-field">
												<span className="range-sublabel">終了</span>
												<div className="range-input-group">
													<input
														type="text"
														className="time-input"
														value={r.end}
														onChange={(e) => updateRange(r.id, 'end', e.target.value)}
														disabled={busy}
													/>
													<button
														type="button"
														className="btn-mark btn-stop"
														onClick={() => markCurrentTime(r.id, 'end')}
														disabled={busy || !previewUrl}
														title="動画・音声の現在再生位置を終了時刻にセット"
													>
														STOP
													</button>
												</div>
											</div>

											<div className="range-actions">
												<button
													type="button"
													className="icon-btn btn-play"
													onClick={() => playRange(r.start)}
													disabled={!previewUrl}
													title="この開始位置からプレビュー再生"
												>
													<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
														<polygon points="5 3 19 12 5 21 5 3" />
													</svg>
												</button>

												{ranges.length > 1 && (
													<button
														type="button"
														className="icon-btn btn-delete"
														onClick={() => removeRange(r.id)}
														disabled={busy}
														title="この範囲を削除"
													>
														<svg
															width="14"
															height="14"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															strokeWidth="2"
														>
															<line x1="18" y1="6" x2="6" y2="18" />
															<line x1="6" y1="6" x2="18" y2="18" />
														</svg>
													</button>
												)}
											</div>
										</div>
									</div>
								))}
							</div>

							{ranges.length > 1 && (
								<div className="cut-hint-box">
									<svg
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
									>
										<circle cx="12" cy="12" r="10" />
										<line x1="12" y1="16" x2="12" y2="12" />
										<line x1="12" y1="8" x2="12.01" y2="8" />
									</svg>
									<span>
										指定された複数の切り出し区間は自動的に連結・結合され、1本のファイルとして再エンコード出力されます。
									</span>
								</div>
							)}
						</div>
					</div>
				);
			default:
				return null;
		}
	};

	const renderStatus = () => {
		if (phase === 'uploading') {
			return (
				<div className="status is-uploading" role="status" aria-live="polite">
					<div className="status-header">
						<div className="status-main">
							<span className="spinner is-accent" aria-hidden="true" />
							<div>
								<p className="status-title">ファイルをアップロード中</p>
								<p className="status-sub">サーバーへデータを転送しています…</p>
							</div>
						</div>
						<span className="status-percentage">{progress}%</span>
					</div>
					<div className="bar">
						<div className="bar-fill" style={{ width: `${progress}%` }} />
					</div>
				</div>
			);
		}
		if (phase === 'running') {
			const queued = !job || job.status === 'queued';
			const progressData = job && job.progress;
			const pct = progressData ? progressData.percent : 0;
			const eta =
				progressData && progressData.etaSeconds != null ? formatEta(progressData.etaSeconds) : null;
			const speed = progressData && progressData.speed ? progressData.speed : null;

			return (
				<div
					className={`status ${queued ? 'is-queued' : 'is-processing'}`}
					role="status"
					aria-live="polite"
				>
					<div className="status-header">
						<div className="status-main">
							<span className={`spinner ${queued ? 'is-wait' : ''}`} aria-hidden="true" />
							<div>
								{queued ? (
									<>
										<p className="status-title">キュー待機中</p>
										<p className="status-sub">
											{job && job.ahead > 0
												? `あなたの前に ${job.ahead} 件のリクエストが待機しています`
												: 'サーバーの実行枠が空き次第、直ちに処理が開始されます'}
										</p>
									</>
								) : (
									<>
										<p className="status-title">
											メディアを変換処理中 {pct > 0 ? `(${pct}%)` : ''}
										</p>
										<p className="status-sub">
											{eta ? `残り推定時間: 約 ${eta}` : ''}
											{speed ? ` ・ 処理速度: ${speed}` : ''}
											{!eta && !speed && 'エンコード中… 完了すると自動的にダウンロードされます'}
										</p>
									</>
								)}
							</div>
						</div>
						<div className="status-actions">
							{!queued && pct > 0 && <span className="status-percentage">{pct}%</span>}
							<button type="button" className="btn-secondary btn-sm" onClick={cancel}>
								キャンセル
							</button>
						</div>
					</div>

					{!queued && (
						<div className="bar">
							<div className="bar-fill" style={{ width: `${pct}%` }} />
						</div>
					)}
				</div>
			);
		}
		if (phase === 'done') {
			return (
				<div className="status is-done" role="status" aria-live="polite">
					<div className="status-main">
						<div className="status-icon is-ok">
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
							>
								<polyline points="20 6 9 17 4 12" />
							</svg>
						</div>
						<div>
							<p className="status-title">変換が正常に完了しました</p>
							<p className="status-sub">
								ブラウザで自動ダウンロードが開始されました。サーバー上の一時ファイルは自動削除済みです。
							</p>
						</div>
					</div>
					<button type="button" className="btn-primary btn-sm" onClick={() => reset(true)}>
						続けて別のファイルを変換
					</button>
				</div>
			);
		}
		if (phase === 'error') {
			return (
				<div className="status is-error" role="alert">
					<div className="status-main">
						<div className="status-icon is-err">
							<svg
								width="20"
								height="20"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
							>
								<line x1="18" y1="6" x2="6" y2="18" />
								<line x1="6" y1="6" x2="18" y2="18" />
							</svg>
						</div>
						<div>
							<p className="status-title">処理中にエラーが発生しました</p>
							<p className="status-sub">{message}</p>
						</div>
					</div>
					<button type="button" className="btn-secondary btn-sm" onClick={() => reset(false)}>
						設定を見直してやり直す
					</button>
				</div>
			);
		}
		return null;
	};

	const acceptAttr = mode.accept.map((e) => `.${e}`).join(',');
	const multiple = Boolean(mode.multi) || mode.id === 'still';

	return (
		<div className="app">
			<header className="app-header">
				<div className="header-brand">
					<div className="brand-logo">
						<svg
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
						>
							<polygon points="23 7 16 12 23 17 23 7" />
							<rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
						</svg>
					</div>
					<div>
						<h1>メディア変換 Studio</h1>
						<p className="brand-sub">高速FFmpegキューエンジンによる高品位動画・音声プロセッサー</p>
					</div>
				</div>
			</header>

			<div className="layout">
				<nav className="modes" aria-label="機能の選択">
					<div className="modes-label">ツールメニュー</div>
					{MODES.map((m) => (
						<div key={m.id} className="mode-item-wrapper">
							<button
								type="button"
								className={`mode ${m.id === modeId ? 'is-active' : ''}`}
								aria-current={m.id === modeId ? 'true' : undefined}
								onClick={() => changeMode(m.id)}
								disabled={busy && m.id !== modeId}
							>
								<span className="mode-icon">{m.icon}</span>
								<span className="mode-text">{m.label}</span>
							</button>
							<button
								type="button"
								className="btn-info"
								onClick={(e) => {
									e.stopPropagation();
									setSpecModalMode(m);
								}}
								aria-label={`${m.label} の詳細仕様・諸元を確認`}
								title={`${m.label} の詳細仕様・FFmpegコマンドを確認`}
							>
								i
							</button>
						</div>
					))}
				</nav>

				<main className="panel">
					<div className="panel-header">
						<div className="panel-title-row">
							<h2>{mode.label}</h2>
							<button
								type="button"
								className="btn-info-badge"
								onClick={() => setSpecModalMode(mode)}
								title={`${mode.label} の詳細仕様・FFmpegコマンドを確認`}
							>
								<span className="info-circle">i</span>
								<span>変換仕様・コマンド諸元</span>
							</button>
						</div>
						<p className="panel-desc">{mode.desc}</p>
					</div>

					<div
						className={`dropzone ${dragOver ? 'is-over' : ''} ${busy ? 'is-disabled' : ''}`}
						role="button"
						tabIndex={busy ? -1 : 0}
						aria-label="ファイルを選択またはドロップ"
						onClick={() => !busy && inputRef.current && inputRef.current.click()}
						onKeyDown={(e) => {
							if ((e.key === 'Enter' || e.key === ' ') && !busy) {
								e.preventDefault();
								inputRef.current.click();
							}
						}}
						onDragOver={(e) => {
							e.preventDefault();
							if (!busy) setDragOver(true);
						}}
						onDragLeave={() => setDragOver(false)}
						onDrop={onDrop}
					>
						<div className="dropzone-icon">
							<svg
								width="36"
								height="36"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
							>
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
								<polyline points="17 8 12 3 7 8" />
								<line x1="12" y1="3" x2="12" y2="15" />
							</svg>
						</div>
						<p className="dropzone-main">
							{mode.id === 'still'
								? '音声ファイル と 静止画 をここにドロップ'
								: mode.multi
									? '複数の動画ファイルをまとめてここにドロップ'
									: '処理したいファイルをここにドロップ'}
						</p>
						<p className="dropzone-sub">
							またはクリックしてフォルダから選択 ／ 対応形式:{' '}
							<strong>{mode.accept.join('・').toUpperCase()}</strong>
						</p>
						<input
							ref={inputRef}
							type="file"
							hidden
							multiple={multiple}
							accept={acceptAttr}
							onChange={(e) => {
								addFiles(e.target.files);
								e.target.value = '';
							}}
						/>
					</div>

					{files.length > 0 && (
						<div className="files-section">
							<div className="files-header">
								<span className="files-title">選択中のファイル ({files.length}件)</span>
								{mode.id === 'concat' && (
									<span className="files-hint">
										ドラッグ＆ドロップまたは矢印で結合順序を変更できます
									</span>
								)}
							</div>
							<ul className="files">
								{files.map((f, i) => (
									<li
										key={`${f.name}-${i}`}
										className={`file ${mode.id === 'concat' ? 'is-draggable' : ''}`}
										draggable={mode.id === 'concat' && !busy}
										onDragStart={(e) => handleItemDragStart(e, i)}
										onDragOver={(e) => e.preventDefault()}
										onDrop={(e) => handleItemDrop(e, i)}
									>
										{mode.id === 'concat' && (
											<div className="drag-handle" title="ドラッグして並び替え">
												<svg
													width="14"
													height="14"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2.5"
												>
													<circle cx="9" cy="5" r="1" />
													<circle cx="9" cy="12" r="1" />
													<circle cx="9" cy="19" r="1" />
													<circle cx="15" cy="5" r="1" />
													<circle cx="15" cy="12" r="1" />
													<circle cx="15" cy="19" r="1" />
												</svg>
												<span className="order-badge">#{i + 1}</span>
											</div>
										)}
										<div className="file-kind-icon">
											{isAudio(f) ? (
												<svg
													width="16"
													height="16"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
												>
													<path d="M9 18V5l12-2v13" />
													<circle cx="6" cy="18" r="3" />
													<circle cx="18" cy="16" r="3" />
												</svg>
											) : isImage(f) ? (
												<svg
													width="16"
													height="16"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
												>
													<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
													<circle cx="8.5" cy="8.5" r="1.5" />
													<polyline points="21 15 16 10 5 21" />
												</svg>
											) : (
												<svg
													width="16"
													height="16"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
												>
													<polygon points="23 7 16 12 23 17 23 7" />
													<rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
												</svg>
											)}
										</div>
										<span className="file-name" title={f.name}>
											{f.name}
										</span>
										<span className="file-size">{formatSize(f.size)}</span>
										{mode.id === 'concat' && (
											<div className="file-order-actions">
												<button
													type="button"
													className="icon-btn"
													onClick={() => moveFile(i, -1)}
													disabled={busy || i === 0}
													aria-label="上へ移動"
												>
													↑
												</button>
												<button
													type="button"
													className="icon-btn"
													onClick={() => moveFile(i, 1)}
													disabled={busy || i === files.length - 1}
													aria-label="下へ移動"
												>
													↓
												</button>
											</div>
										)}
										<button
											type="button"
											className="icon-btn btn-delete"
											onClick={() => removeFile(i)}
											disabled={busy}
											aria-label={`${f.name} を削除`}
										>
											<svg
												width="14"
												height="14"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
											>
												<line x1="18" y1="6" x2="6" y2="18" />
												<line x1="6" y1="6" x2="18" y2="18" />
											</svg>
										</button>
									</li>
								))}
							</ul>
						</div>
					)}

					<div className="params">{renderParams()}</div>

					{notice && (
						<div className="notice-box" role="alert">
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<circle cx="12" cy="12" r="10" />
								<line x1="12" y1="8" x2="12" y2="12" />
								<line x1="12" y1="16" x2="12.01" y2="16" />
							</svg>
							<span>{notice}</span>
						</div>
					)}

					<div className="actions">
						<button
							type="button"
							className="btn-primary btn-submit"
							onClick={submit}
							disabled={busy || probing}
						>
							{probing ? (
								<>
									<span className="spinner is-light" aria-hidden="true" />
									メディア解析中…
								</>
							) : busy ? (
								<>
									<span className="spinner is-light" aria-hidden="true" />
									キュー処理中…
								</>
							) : (
								<>
									<svg
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.5"
									>
										<polygon points="5 3 19 12 5 21 5 3" />
									</svg>
									変換を実行する
								</>
							)}
						</button>
					</div>

					{renderStatus()}
				</main>
			</div>

			{/* ---- 諸元確認モーダル ---- */}
			{specModalMode && specModalMode.specs && (
				<div
					className="modal-backdrop"
					onClick={() => setSpecModalMode(null)}
					role="dialog"
					aria-modal="true"
				>
					<div className="modal-card" onClick={(e) => e.stopPropagation()}>
						<div className="modal-header">
							<div className="modal-title-group">
								<span className="modal-icon">{specModalMode.icon}</span>
								<div>
									<h3 className="modal-title">{specModalMode.specs.title}</h3>
									<p className="modal-subtitle">{specModalMode.desc}</p>
								</div>
							</div>
							<button
								type="button"
								className="modal-close-btn"
								onClick={() => setSpecModalMode(null)}
								aria-label="閉じる"
							>
								×
							</button>
						</div>

						<div className="modal-body">
							<div className="spec-comparison-grid">
								<div className="spec-box is-changes">
									<div className="spec-box-header">
										<span className="spec-tag is-change">変更される要素</span>
									</div>
									<ul className="spec-list">
										{specModalMode.specs.changes.map((item, idx) => (
											<li key={idx}>{item}</li>
										))}
									</ul>
								</div>

								<div className="spec-box is-keeps">
									<div className="spec-box-header">
										<span className="spec-tag is-keep">保持される要素（不変・無劣化）</span>
									</div>
									<ul className="spec-list">
										{specModalMode.specs.keeps.map((item, idx) => (
											<li key={idx}>{item}</li>
										))}
									</ul>
								</div>
							</div>

							<div className="spec-section">
								<h4 className="spec-section-title">実行されるFFmpegコマンドライン（等価例）</h4>
								<pre className="command-pre">
									<code>{specModalMode.specs.command}</code>
								</pre>
							</div>

							<div className="spec-section">
								<h4 className="spec-section-title">技術解説・パラメータ諸元</h4>
								<p className="spec-detail-text">{specModalMode.specs.details}</p>
							</div>
						</div>

						<div className="modal-footer">
							<button
								type="button"
								className="btn-primary btn-sm"
								onClick={() => setSpecModalMode(null)}
							>
								閉じる
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
