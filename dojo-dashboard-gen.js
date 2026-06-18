#!/usr/bin/env node
/**
 * dojo-dashboard-gen.js
 * Reads dojo-data.json -> writes dojo-dashboard.html
 * Run: node dojo-dashboard-gen.js
 * Also copies to Desktop/ClawdVanDam/AODHQ Dashboards/ if the folder exists.
 */
const fs = require('fs');
const path = require('path');
const { getDataPaths, isTestMode } = require('./lib/discord-config');

const paths = getDataPaths();
const dataPath = paths.dataFile;
const outPath = paths.dashboardHtmlFile;
const desktopCopy = path.join(process.env.USERPROFILE || process.env.HOME, 'OneDrive', 'Desktop', 'ClawdVanDam', 'AODHQ Dashboards', 'Dojo Student Tracker.html');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Reconcile clips: s.clips always = max(s.clips, timestamps.length)
let reconciled = 0;
for (const s of data.students) {
  const tsCount = (s.clip_timestamps || []).length;
  const correct = Math.max(s.clips || 0, tsCount);
  if (correct !== (s.clips || 0)) { s.clips = correct; reconciled++; }
}
if (reconciled > 0) {
  data.meta.totalClips = data.students.reduce((a, s) => a + (s.clips || 0), 0);
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`Reconciled ${reconciled} students' clip counts`);
}

const studentsJSON = JSON.stringify(data.students);
const meta = data.meta;

// Build HTML with simple string concatenation to avoid template escaping hell
const html = [
'<!DOCTYPE html>',
'<html lang="en">',
'<head>',
'<meta charset="UTF-8">',
'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
'<title>AODHQ Dojo — BPM Ninjas</title>',
'<style>',
'  * { margin: 0; padding: 0; box-sizing: border-box; }',
'  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background: #0f1117; color: #e0e0e0; }',
'  .header { background: linear-gradient(135deg, #1a1d2e 0%, #0f1117 100%); padding: 24px 32px; border-bottom: 2px solid #ff6b35; }',
'  .header h1 { font-size: 24px; font-weight: 700; color: #fff; }',
'  .header h1 span { color: #ff6b35; }',
'  .header .subtitle { color: #888; font-size: 13px; margin-top: 4px; }',
'  .tier-rules { color: #666; font-size: 11px; margin-top: 8px; line-height: 1.8; }',
'  .tier-rules span { font-weight: 600; }',
'  .tier-rules .t-elite { color: #ff6b35; }',
'  .tier-rules .t-chunin { color: #ffd700; }',
'  .tier-rules .t-genin { color: #4caf50; }',
'  .tier-rules .t-ghost { color: #555; }',
'  .stats-bar { display: flex; gap: 12px; padding: 16px 32px; flex-wrap: wrap; }',
'  .stat-card { background: #1a1d2e; border: 1px solid #2a2d3e; border-radius: 10px; padding: 14px 20px; min-width: 110px; text-align: center; }',
'  .stat-card .num { font-size: 28px; font-weight: 700; }',
'  .stat-card .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }',
'  .controls { padding: 12px 32px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }',
'  .search-box { background: #1a1d2e; border: 1px solid #2a2d3e; border-radius: 8px; padding: 10px 16px; color: #e0e0e0; font-size: 14px; width: 260px; outline: none; }',
'  .search-box:focus { border-color: #ff6b35; }',
'  .search-box::placeholder { color: #555; }',
'  .filter-btn { background: #1a1d2e; border: 1px solid #2a2d3e; border-radius: 8px; padding: 8px 14px; color: #888; font-size: 12px; cursor: pointer; transition: all 0.2s; font-weight: 600; }',
'  .filter-btn:hover { border-color: #ff6b35; color: #e0e0e0; }',
'  .filter-btn.active { background: #ff6b35; border-color: #ff6b35; color: #fff; }',
'  .table-wrap { padding: 0 32px 32px; overflow-x: auto; }',
'  table { width: 100%; border-collapse: collapse; font-size: 13px; }',
'  thead th { background: #1a1d2e; color: #888; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; padding: 12px 8px; text-align: left; border-bottom: 2px solid #2a2d3e; cursor: pointer; user-select: none; white-space: nowrap; position: sticky; top: 0; z-index: 10; }',
'  thead th:hover { color: #ff6b35; }',
'  thead th.sorted-asc::after { content: " ▲"; color: #ff6b35; }',
'  thead th.sorted-desc::after { content: " ▼"; color: #ff6b35; }',
'  tbody tr { border-bottom: 1px solid #1a1d2e; transition: background 0.15s; }',
'  tbody tr:hover { background: #1a1d2e; }',
'  tbody tr.inactive { opacity: 0.35; }',
'  tbody tr.inactive:hover { opacity: 0.6; }',
'  td { padding: 8px; white-space: nowrap; }',
'  .tier-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 700; }',
'  .tier-elite { background: rgba(255,107,53,0.15); color: #ff6b35; }',
'  .tier-chunin { background: rgba(255,215,0,0.15); color: #ffd700; }',
'  .tier-genin { background: rgba(76,175,80,0.15); color: #4caf50; }',
'  .tier-ghost { background: rgba(85,85,85,0.15); color: #555; }',
'  .inactive-badge { display: inline-block; padding: 2px 6px; border-radius: 8px; font-size: 9px; font-weight: 700; background: rgba(244,67,54,0.1); color: #f44336; margin-left: 6px; }',
'  .active-badge { display: inline-block; padding: 2px 6px; border-radius: 8px; font-size: 9px; font-weight: 700; background: rgba(76,175,80,0.1); color: #4caf50; margin-left: 6px; }',
'  .bpm { font-weight: 700; font-variant-numeric: tabular-nums; }',
'  .bpm-start { color: #888; }',
'  .bpm-high { color: #ff6b35; }',
'  .bpm-current { color: #00e5ff; }',
'  .bpm-growth { font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 8px; }',
'  .bpm-growth.positive { background: rgba(76,175,80,0.15); color: #4caf50; }',
'  .bpm-growth.zero { color: #555; }',
'  .vid-count { font-weight: 700; font-variant-numeric: tabular-nums; }',
'  .vid-elite { color: #ff6b35; }',
'  .vid-chunin { color: #ffd700; }',
'  .vid-low { color: #4caf50; }',
'  .vid-zero { color: #333; }',
'  .msg-count { font-weight: 700; font-variant-numeric: tabular-nums; }',
'  .msg-high { color: #e040fb; }',
'  .msg-mid { color: #ab47bc; }',
'  .msg-low { color: #7e57c2; }',
'  .msg-zero { color: #333; }',
'  .home { color: #888; font-size: 12px; }',
'  .na { color: #333; }',
'  .footer { padding: 16px 32px; color: #444; font-size: 12px; text-align: center; border-top: 1px solid #1a1d2e; }',
'</style>',
'</head>',
'<body>',
'<div class="header">',
'  <h1>\u{1F977} AODHQ Dojo \u2014 <span>BPM Ninjas</span></h1>',
'  <div class="subtitle">' + data.students.length + ' BPM Ninjas \u2022 Last updated: ' + meta.lastUpdated + ' \u2022 Auto-generated from dojo-data.json</div>',
'  <div class="tier-rules">',
'    <span class="t-elite">\u{1F525} Elite J\u014Dnin</span> = 50+ practice vids &nbsp;|&nbsp;',
'    <span class="t-chunin">\u2B50 Ch\u016Bnin</span> = 20+ practice vids &nbsp;|&nbsp;',
'    <span class="t-genin">\u{1F331} Genin</span> = 1+ practice vids &nbsp;|&nbsp;',
'    <span class="t-ghost">\u{1F47B} Ghost</span> = 0 practice vids &nbsp;|&nbsp;',
'    \u26AA Greyed = inactive 2+ months',
'  </div>',
'</div>',
'<div class="stats-bar" id="statsBar"></div>',
'<div class="controls">',
'  <input type="text" class="search-box" id="searchBox" placeholder="Search name, username, home...">',
'  <button class="filter-btn active" data-tier="all">All</button>',
'  <button class="filter-btn" data-tier="elite">\u{1F525} Elite J\u014Dnin</button>',
'  <button class="filter-btn" data-tier="chunin">\u2B50 Ch\u016Bnin</button>',
'  <button class="filter-btn" data-tier="genin">\u{1F331} Genin</button>',
'  <button class="filter-btn" data-tier="ghost">\u{1F47B} Ghost</button>',
'  <button class="filter-btn" data-tier="inactive">\u26AA Inactive</button>',
'  <button class="filter-btn" data-tier="active-only">\u{1F7E2} Active Only</button>',
'</div>',
'<div class="table-wrap">',
'  <table>',
'    <thead><tr>',
'      <th data-col="rank">#</th>',
'      <th data-col="tier">Rank</th>',
'      <th data-col="status">Status</th>',
'      <th data-col="name">Name</th>',
'      <th data-col="username">Username</th>',
'      <th data-col="join">Join Date</th>',
'      <th data-col="clips">Practice Vids</th>',
'      <th data-col="msgs">Messages</th>',
'      <th data-col="startBpm">Start BPM</th>',
'      <th data-col="highBpm">Peak BPM</th>',
'      <th data-col="currentBpm">Current BPM</th>',
'      <th data-col="growth">Growth</th>',
'      <th data-col="home">Home</th>',
'    </tr></thead>',
'    <tbody id="tableBody"></tbody>',
'  </table>',
'</div>',
'<div class="footer">Built by ClawdVanDam \u{1F941} \u2022 Practice Vids: ' + meta.clipsScanPeriod + ' \u2022 Hall: ' + meta.hallScanPeriod + '</div>',
'<script>',
'const S = ' + studentsJSON + ';',
'',
'function classify(s) {',
'  if (s.clips >= 50) return "elite";',
'  if (s.clips >= 20) return "chunin";',
'  if (s.clips >= 1) return "genin";',
'  return "ghost";',
'}',
'S.forEach(function(s) { s.tier = classify(s); });',
'',
'var TO = {elite:0,chunin:1,genin:2,ghost:3};',
'var TL = {elite:"\\u{1F525} Elite J\\u014Dnin",chunin:"\\u2B50 Ch\\u016Bnin",genin:"\\u{1F331} Genin",ghost:"\\u{1F47B} Ghost"};',
'var TC = {elite:"tier-elite",chunin:"tier-chunin",genin:"tier-genin",ghost:"tier-ghost"};',
'',
'var curF="all",curS={col:"tier",dir:"asc"},search="";',
'',
'function totalMsgs(s){return s.comments+s.tech+s.lounge+(s.qwei>0?s.qwei:0)+s.hall;}',
'function msgH(v){if(v>=100)return\'<span class="msg-count msg-high">\'+v+\'</span>\';if(v>=20)return\'<span class="msg-count msg-mid">\'+v+\'</span>\';if(v>=1)return\'<span class="msg-count msg-low">\'+v+\'</span>\';return\'<span class="msg-count msg-zero">0</span>\';}',
'function vidH(v){if(v>=50)return\'<span class="vid-count vid-elite">\'+v+\'</span>\';if(v>=20)return\'<span class="vid-count vid-chunin">\'+v+\'</span>\';if(v>=1)return\'<span class="vid-count vid-low">\'+v+\'</span>\';return\'<span class="vid-count vid-zero">0</span>\';}',
'function bpmVal(v,fb){return(v!=null&&v!==undefined&&String(v)!=="undefined")?v:fb;}',
'function bpmDisplay(v,cls){return v!=null&&String(v)!=="undefined"?"<span class=\\"bpm "+cls+"\\">"+v+"</span>":"<span class=\\"na\\">\\u2014</span>";}',
'function grH(s){var hi=bpmVal(s.highBpm,s.startBpm||0);var st=s.startBpm||0;var d=hi-st;return d>0?\'<span class="bpm-growth positive">+\'+d+\'</span>\':\'<span class="bpm-growth zero">\\u2014</span>\';}',

'function stH(s){return s.active?\'<span class="active-badge">ACTIVE</span>\':\'<span class="inactive-badge">INACTIVE</span>\';}',
'',
'function stats(d){',
'  var c={total:d.length,elite:0,chunin:0,genin:0,ghost:0,activeN:0,inactiveN:0};',
'  var tv=0,tm=0,ts=0,thh=0,n=0;',
'  d.forEach(function(s){c[s.tier]++;tv+=s.clips;tm+=totalMsgs(s);if(s.active)c.activeN++;else c.inactiveN++;if(s.highBpm>s.startBpm){ts+=s.startBpm;thh+=s.highBpm;n++;}});',
'  var ag=n?Math.round((thh-ts)/n):0;',
'  document.getElementById("statsBar").innerHTML=',
'    \'<div class="stat-card" style="border-color:#ff6b35"><div class="num" style="color:#ff6b35">\'+c.total+\'</div><div class="label">Ninjas</div></div>\'+',
'    \'<div class="stat-card" style="border-color:#ffd700"><div class="num" style="color:#ffd700">\'+tv.toLocaleString()+\'</div><div class="label">Practice Vids</div></div>\'+',
'    \'<div class="stat-card" style="border-color:#4caf50"><div class="num" style="color:#4caf50">\'+c.activeN+\'</div><div class="label">Active</div></div>\'+',
'    \'<div class="stat-card" style="border-color:#555"><div class="num" style="color:#555">\'+c.inactiveN+\'</div><div class="label">Inactive</div></div>\'+',
'    \'<div class="stat-card" style="border-color:#ff6b35"><div class="num" style="color:#ff6b35">\'+c.elite+\'</div><div class="label">Elite J\\u014Dnin</div></div>\'+',
'    \'<div class="stat-card" style="border-color:#ffd700"><div class="num" style="color:#ffd700">\'+c.chunin+\'</div><div class="label">Ch\\u016Bnin</div></div>\'+',
'    \'<div class="stat-card" style="border-color:#4caf50"><div class="num" style="color:#4caf50">\'+c.genin+\'</div><div class="label">Genin</div></div>\'+',
'    \'<div class="stat-card" style="border-color:#00e5ff"><div class="num" style="color:#00e5ff">+\'+ag+\'</div><div class="label">Avg Growth</div></div>\';',
'}',
'',
'function render(){',
'  var d=S.slice();',
'  if(curF==="inactive")d=d.filter(function(s){return !s.active;});',
'  else if(curF==="active-only")d=d.filter(function(s){return s.active;});',
'  else if(curF!=="all")d=d.filter(function(s){return s.tier===curF;});',
'  if(search){var q=search.toLowerCase();d=d.filter(function(s){return s.name.toLowerCase().indexOf(q)>=0||s.u.toLowerCase().indexOf(q)>=0||(s.loc||"").toLowerCase().indexOf(q)>=0;});}',
'',
'  d.sort(function(a,b){',
'    var va,vb,c=curS.col;',
'    if(c==="tier"||c==="rank"){',
'      var ta=TO[a.tier], tb=TO[b.tier];',
'      if(ta!==tb) return curS.dir==="asc"?ta-tb:tb-ta;',
'      var aa=a.active?0:1, ab=b.active?0:1;',
'      if(aa!==ab) return aa-ab;',
'      return b.clips-a.clips;',
'    }',
'    if(c==="status"){va=a.active?0:1;vb=b.active?0:1;}',
'    else if(c==="name"){va=a.name.toLowerCase();vb=b.name.toLowerCase();}',
'    else if(c==="username"){va=a.u;vb=b.u;}',
'    else if(c==="join"){va=a.join||"z";vb=b.join||"z";}',
'    else if(c==="clips"){va=a.clips;vb=b.clips;}',
'    else if(c==="msgs"){va=totalMsgs(a);vb=totalMsgs(b);}',
'    else if(c==="startBpm"){va=a.startBpm||0;vb=b.startBpm||0;}',
'    else if(c==="highBpm"){va=a.highBpm||0;vb=b.highBpm||0;}',
'    else if(c==="currentBpm"){va=a.currentBpm||0;vb=b.currentBpm||0;}',
'    else if(c==="growth"){va=(a.highBpm||0)-(a.startBpm||0);vb=(b.highBpm||0)-(b.startBpm||0);}',
'    else if(c==="home"){va=(a.loc||"").toLowerCase();vb=(b.loc||"").toLowerCase();}',
'    else{va=0;vb=0;}',
'    if(va<vb)return curS.dir==="asc"?-1:1;if(va>vb)return curS.dir==="asc"?1:-1;return 0;',
'  });',
'',
'  stats(d);',
'  var rows="";',
'  for(var i=0;i<d.length;i++){',
'    var s=d[i];',
'    rows+=\'<tr class="\'+(!s.active?"inactive":"")+\'">\'+',
'    \'<td style="color:#555;font-size:12px">\'+(i+1)+\'</td>\'+',
'    \'<td><span class="tier-badge \'+TC[s.tier]+\'">\'+TL[s.tier]+\'</span></td>\'+',
'    \'<td>\'+stH(s)+\'</td>\'+',
'    \'<td style="font-weight:600;color:\'+(s.active?"#fff":"#555")+\'">\'+s.name+\'</td>\'+',
'    \'<td style="color:#666;font-size:12px">\'+s.u+\'</td>\'+',
'    \'<td>\'+(s.join||\'<span class="na">\\u2014</span>\')+\'</td>\'+',
'    \'<td>\'+vidH(s.clips)+\'</td>\'+',
'    \'<td>\'+msgH(totalMsgs(s))+\'</td>\'+',
'    \'<td>\'+bpmDisplay(bpmVal(s.startBpm,null),\'bpm-start\')+\'</td>\'+',
'    \'<td>\'+bpmDisplay(bpmVal(s.highBpm,s.startBpm),\'bpm-high\')+\'</td>\'+',
'    \'<td>\'+bpmDisplay(bpmVal(s.currentBpm,s.startBpm),\'bpm-current\')+\'</td>\'+',
'    \'<td>\'+grH(s)+\'</td>\'+',
'    \'<td class="home">\'+(s.loc||"")+\'</td>\'+',
'    \'</tr>\';',
'  }',
'  document.getElementById("tableBody").innerHTML=rows;',
'  var ths=document.querySelectorAll("thead th");',
'  for(var j=0;j<ths.length;j++){ths[j].classList.remove("sorted-asc","sorted-desc");if(ths[j].dataset.col===curS.col)ths[j].classList.add("sorted-"+curS.dir);}',
'}',
'',
'var btns=document.querySelectorAll(".filter-btn");',
'for(var i=0;i<btns.length;i++){btns[i].addEventListener("click",function(){for(var j=0;j<btns.length;j++)btns[j].classList.remove("active");this.classList.add("active");curF=this.dataset.tier;render();});}',
'var ths=document.querySelectorAll("thead th");',
'for(var i=0;i<ths.length;i++){ths[i].addEventListener("click",function(){var c=this.dataset.col;if(curS.col===c)curS.dir=curS.dir==="asc"?"desc":"asc";else{curS.col=c;curS.dir="asc";}render();});}',
'document.getElementById("searchBox").addEventListener("input",function(e){search=e.target.value;render();});',
'render();',
'</script>',
'</body>',
'</html>'
].join('\n');

fs.writeFileSync(outPath, html, 'utf8');
console.log('Dashboard written to ' + outPath);

// Copy to Desktop if folder exists
try {
  const dir = path.dirname(desktopCopy);
  if (fs.existsSync(dir)) {
    fs.writeFileSync(desktopCopy, html, 'utf8');
    console.log('Copied to ' + desktopCopy);
  }
} catch (e) {
  console.log('Desktop copy skipped: ' + e.message);
}

// Push to GitHub Pages repo + Gist if token exists (never in test mode)
const tokenPath = path.join(__dirname, '.github-token.json');
if (isTestMode()) {
  console.log('Test mode — GitHub Pages push skipped');
} else if (fs.existsSync(tokenPath)) {
  const https = require('https');
  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8')).token;

  function ghApi(method, apiPath, body) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const options = {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          'Authorization': 'token ' + token,
          'User-Agent': 'CVD-Dashboard',
          'Accept': 'application/vnd.github+json',
        }
      };
      if (payload) {
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(payload);
      }
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // 1) Push to GitHub Pages repo (Dreamusichef/aodhq-dojo-dashboard)
  const owner = 'Dreamusichef';
  const repo = 'aodhq-dojo-dashboard';
  const content = Buffer.from(html).toString('base64');

  ghApi('GET', '/repos/' + owner + '/' + repo + '/contents/index.html')
    .then(existing => {
      let sha = null;
      if (existing.status === 200) {
        try { sha = JSON.parse(existing.body).sha; } catch(e) {}
      }
      const putBody = {
        message: 'Dashboard update ' + new Date().toISOString(),
        content,
        branch: 'main'
      };
      if (sha) putBody.sha = sha;
      return ghApi('PUT', '/repos/' + owner + '/' + repo + '/contents/index.html', putBody);
    })
    .then(r => {
      if (r.status === 200 || r.status === 201) {
        console.log('GitHub Pages updated: https://dreamusichef.github.io/aodhq-dojo-dashboard/');
      } else {
        console.log('Pages push failed (' + r.status + '): ' + r.body.slice(0, 200));
      }
    })
    .catch(e => console.log('Pages push error: ' + e.message));

  // 1b) Publish a slimmed public dojo-data.json for the live dashboard frontend to fetch.
  //     (Drops clip_timestamps + internal notes; served with CORS * by GitHub Pages.)
  const publicStudents = data.students.map(s => ({
    name: s.name, u: s.u, loc: s.loc || '', clips: s.clips || 0,
    comments: s.comments || 0, tech: s.tech || 0, lounge: s.lounge || 0, qwei: s.qwei || 0, hall: s.hall || 0,
    startBpm: s.startBpm ?? null, highBpm: s.highBpm ?? null, currentBpm: s.currentBpm ?? null,
    active: !!s.active, join: s.join || null,
  }));
  const publicData = { meta: { totalClips: meta.totalClips, lastUpdated: meta.lastUpdated, count: publicStudents.length }, students: publicStudents };
  const dataB64 = Buffer.from(JSON.stringify(publicData)).toString('base64');
  ghApi('GET', '/repos/' + owner + '/' + repo + '/contents/dojo-data.json')
    .then(existing => {
      let sha = null;
      if (existing.status === 200) { try { sha = JSON.parse(existing.body).sha; } catch (e) {} }
      const body = { message: 'Data update ' + new Date().toISOString(), content: dataB64, branch: 'main' };
      if (sha) body.sha = sha;
      return ghApi('PUT', '/repos/' + owner + '/' + repo + '/contents/dojo-data.json', body);
    })
    .then(r => console.log((r.status === 200 || r.status === 201)
      ? 'Public data updated: https://dreamusichef.github.io/aodhq-dojo-dashboard/dojo-data.json'
      : 'Data push failed (' + r.status + '): ' + r.body.slice(0, 160)))
    .catch(e => console.log('Data push error: ' + e.message));

  // 2) Also update Gist (legacy, keeps old links working)
  const gistId = 'd2ab52cb0aa21eac8bb3a26f4b9a3fb9';
  const gistPayload = JSON.stringify({ files: { 'bpm-ninja-rankings.html': { content: html }, 'dojo-dashboard.html': { content: html } } });
  ghApi('PATCH', '/gists/' + gistId, JSON.parse(gistPayload))
    .then(r => {
      if (r.status === 200) console.log('Gist updated');
      else console.log('Gist update failed (' + r.status + ')');
    })
    .catch(e => console.log('Gist push error: ' + e.message));
} else {
  console.log('No GitHub token found, online push skipped');
}
