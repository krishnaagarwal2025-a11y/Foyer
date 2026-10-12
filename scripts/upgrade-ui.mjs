import {readFileSync,writeFileSync} from 'node:fs';
let s=readFileSync('src/main.tsx','utf8');
s=s.replace('import "./style.css";','import "./style.css";\nimport {FoyerPlayer,type PlaybackHandle} from "./player/FoyerPlayer";\nimport {MusicDiscovery} from "./MusicDiscovery";');
s=s.replace('video = useRef<HTMLVideoElement | null>(null)','video = useRef<PlaybackHandle | null>(null)');
s=s.replace('[muted, setMuted] = useState(false);','[muted, setMuted] = useState(false), [entryMode,setEntryMode]=useState<"watch"|"listen">("watch");');
s=s.replace('name: name.trim(),','name: name.trim(), mode:entryMode,');s=s.replace('[name],','[name,entryMode],');
s=s.replace('const fix = correction(delta, r.playing);','const fix = correction(delta, r.playing); if(v.supportsRate===false){fix.rate=1;fix.seek=Math.abs(delta)>(r.playing?0.4:0.15)}');
const start=s.indexOf('            <video\n'),end=s.indexOf('            <div className="player-top">',start);if(start<0||end<0)throw Error('Player replacement anchor missing');
s=s.slice(0,start)+`            <FoyerPlayer ref={video} media={room.media} revision={room.mediaRevision} muted={muted}
              onReady={()=>{loadedRevision.current=room.mediaRevision;setVideoError('');const duration=video.current?.duration;if(host&&duration&&Number.isFinite(duration)&&Math.abs(duration-room.media.duration)>0.5)command({type:'duration',duration});synchronize()}}
              onPlaying={()=>{setVideoError('');synchronize()}} onSeeked={()=>synchronize()}
              onError={message=>{if(message.toLowerCase().includes('autoplay'))setBlocked(true);else setVideoError(message)}}
              onWaiting={()=>setVideoError('Buffering… playback will catch up when ready.')}
              onEnded={()=>{if(host)command({type:'ended'})}}/>
`+s.slice(end);
s=s.replace('type: "custom",','type: "source", enqueue: data.get("action")==="queue",');
s=s.replace('<h3>Bring your own video</h3>','<h3>Add a link to the room</h3>');
s=s.replace(/Direct MP4, WebM or Ogg URL\. Source must be reachable by every\s+participant\. Sample duration is used as the shared timeline\s+limit\./,'Paste YouTube, Vimeo, SoundCloud, direct audio/video or on-demand HLS. Subscription titles open in the companion extension. Players confirm duration when available.');
s=s.replace('placeholder="Video title"','placeholder="Title"');s=s.replace('placeholder="https://…/video.mp4"','placeholder="YouTube, SoundCloud or a direct media URL"');
s=s.replace('<button disabled={!canControl}>Load video</button>','<button name="action" value="play" disabled={!canControl}>Load video</button><button name="action" value="queue" disabled={status!=="Connected"}>Add to queue</button>');
// FormData does not include submitter without explicitly providing it.
s=s.replace('const data = new FormData(e.currentTarget);','const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);');
s=s.replace('<section className="discovery panel">','{room.settings.mode===\'listen\'&&<MusicDiscovery command={command} canControl={canControl} connected={status===\'Connected\'}/>}\n              <section className="discovery panel">');
s=s.replace('catalog.map((m) => {','catalog.filter(m=>room?.settings.mode!==\'listen\'||m.kind===\'audio\').map((m) => {');
s=s.replace('<h2>Something for everyone.</h2>',"<h2>{room.settings.mode==='listen'?'Your local listening library.':'Something for everyone.'}</h2>");
s=s.replace('{m.url ? "▶ LOCAL & PLAYABLE" : "DISCOVERY SAMPLE"}',"{m.url ? (m.kind==='audio'?'♪ LOCAL AUDIO':'▶ LOCAL & PLAYABLE') : 'DISCOVERY SAMPLE'}");
s=s.replace('video.current?.load();',"if(room.media.kind==='external'){setVideoError('');return;}video.current?.load();");
s=s.replace('aria-label="Toggle sound"','aria-label="Toggle sound" disabled={room.media.kind===\'external\'}');s=s.replace('<button className="small" onClick={synchronize}>',"<button className=\"small\" onClick={synchronize} disabled={room.media.kind==='external'}>");
s=s.replace('Math.abs(drift) <= 0.5 ? "In sync" : "Catching up"',"room.media.kind==='external'?'Companion required':Math.abs(drift) <= 0.5 ? 'In sync' : 'Catching up'");
s=s.replace('if (!room) return;\n    synchronize();',"if (!room) return;\n    if(room.media.kind==='external'){setPosition(expectedPosition(room,monotonic()+offsetRef.current));return;}\n    synchronize();");
s=s.replace('<span className="scene-badge">LOCAL DEMO INCLUDED</span>','<span className="scene-badge">WATCH · LISTEN · BELONG</span>');
s=s.replace('<h2>Settle in.</h2>','<h2>Welcome to Foyer.</h2><div className="mode-switch" aria-label="Choose room type">{(["watch","listen"] as const).map(mode=><button key={mode} className={entryMode===mode?"active":""} onClick={()=>setEntryMode(mode)}>{mode===\'watch\'?\'◉ Watch\':\'♪ Listen\'}</button>)}</div>');
s=s.replace('<div className="room-label">','<div className="mode-switch room-mode" aria-label="Room mode">{(["watch","listen"] as const).map(mode=><button key={mode} className={(room.settings.mode||\'watch\')===mode?\'active\':\'\'} disabled={!host||status!==\'Connected\'} onClick={()=>command({type:\'mode\',mode})}>{mode===\'watch\'?\'◉ Watch\':\'♪ Listen\'}</button>)}</div><div className="room-label">');
s=s.replace(/watch<span className="accent">party<\/span>/g,'F<span className="accent">oyer</span>');
s=s.replace('Direct video · No streaming subscription required','Video, music and your people · Local demo included');
s=s.replace('YOUR CINEMA, TOGETHER','YOUR PEOPLE. YOUR FOYER.');
s=s.replace('Your next favorite night.','A place to press play together.');
s=s.replace('Made for movie nights, wherever you are.','Built for shared moments, wherever you are.');
s=s.replace('Everyone gets a front-row seat.','Foyer · Together, from anywhere.');
s=s.replace('Hosted by','Hosted by');
s=s.replace('{p.connected\n', '{p.connected\n');
s=s.replace('"Connected"\n                          : Math.abs(p.drift)', '"Connected"\n                          : Math.abs(p.drift)');
writeFileSync('src/main.tsx',s);
const pkg=JSON.parse(readFileSync('package.json'));pkg.name='foyer';pkg.version='2.0.0';pkg.scripts.build='tsc --noEmit && vite build && node scripts/build-extension.mjs';pkg.scripts['media:audio']='node scripts/audio.mjs';pkg.scripts['test:extension']='playwright test -c playwright.extension.config.ts';writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
let html=readFileSync('index.html','utf8').replace('Watch Party · Cinema together','Foyer · Watch. Listen. Belong.').replace('</head>','<meta name="description" content="Your private room for synchronized video, shared music and real conversation."><link rel="icon" href="/foyer.svg"></head>');writeFileSync('index.html',html);
