'use strict';

const FLAGS = {
  'Italy': '🇮🇹', 'India': '🇮🇳', 'Israel': '🇮🇱', 'France': '🇫🇷',
  'Singapore': '🇸🇬', 'Wales, UK': '🇬🇧', 'Germany': '🇩🇪', 'Australia': '🇦🇺',
  'UK': '🇬🇧', 'Malta': '🇲🇹', 'Scotland': '🇬🇧', 'NZ': '🇳🇿', 'US': '🇺🇸',
  'Montreal': '🇨🇦', 'Slovenia': '🇸🇮', 'London': '🇬🇧', 'Argentina': '🇦🇷',
  'South France': '🇫🇷', 'S. California': '🇺🇸', 'Perth, AU': '🇦🇺',
  'Brazil': '🇧🇷', 'Turkey': '🇹🇷', 'Ukraine': '🇺🇦', 'LA': '🇺🇸',
  'Uruguay': '🇺🇾', 'NY': '🇺🇸', 'Melbourne': '🇦🇺', 'Greece': '🇬🇷',
  'Norway': '🇳🇴', 'Tunisia / Germany': '🇹🇳', 'Netherlands': '🇳🇱',
  'S. Africa': '🇿🇦', 'Czech Republic': '🇨🇿', 'Philippines': '🇵🇭', 'Taiwan': '🇹🇼',
};

function flag(loc) {
  if (!loc) return '\u{1f3f3}\u{fe0f}';
  return FLAGS[loc] || '\u{1f3f3}\u{fe0f}';
}

function formatLine(rank, name, vids, loc, active) {
  const trophy = rank === 1 ? ' 🏆' : '';
  const status = active === false ? ' 💤' : '';
  const vidLabel = vids === 1 ? 'vid' : 'vids';
  return '`#' + rank + '` ' + flag(loc) + ' **' + name + '**' + trophy + ' — ' + vids + ' ' + vidLabel + status;
}

function generateRankings(data, state) {
  const students = data.students.slice().sort((a, b) => b.clips - a.clips);
  const totalVids = students.reduce((s, x) => s + x.clips, 0);
  const date = new Date().toISOString().slice(0, 10);

  const elite = students.filter(s => s.clips >= 50);
  const chunin = students.filter(s => s.clips >= 20 && s.clips < 50);
  const genin = students.filter(s => s.clips >= 1 && s.clips < 20);
  const ghosts = students.filter(s => s.clips === 0);

  let rank = 1;

  const msg1Lines = [
    '# 🥷 BPM NINJA RANKINGS',
    '',
    "> *Climb the ranks by posting practice videos in #practice-videos!*",
    "> *Rankings update automatically. Your rank = your practice vids count.*",
    '',
    '**Last updated:** ' + date + ' · **Total Practice Vids:** ' + totalVids.toLocaleString(),
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '## 🔥 ELITE JŌNIN — 50+ Practice Vids',
    '',
  ];
  for (const s of elite) {
    msg1Lines.push(formatLine(rank, s.name, s.clips, s.loc, s.active));
    rank++;
  }
  msg1Lines.push('');
  msg1Lines.push('## ⭐ CHŪNIN — 20+ Practice Vids');
  msg1Lines.push('');
  for (const s of chunin) {
    msg1Lines.push(formatLine(rank, s.name, s.clips, s.loc, s.active));
    rank++;
  }

  const msg2Lines = [
    '## 🌱 GENIN — 1+ Practice Vids',
    '',
  ];
  const geninToShow = genin.slice(0, 30);
  const geninRemaining = genin.length - geninToShow.length;
  for (const s of geninToShow) {
    msg2Lines.push(formatLine(rank, s.name, s.clips, s.loc, s.active));
    rank++;
  }
  if (geninRemaining > 0) {
    msg2Lines.push(' #' + rank + '-' + (rank + geninRemaining - 1) + ' + ' + geninRemaining + ' more with 1 vid each');
    rank += geninRemaining;
  }

  const previewUrl = state.gist ? state.gist.previewUrl : '';
  const msg3Lines = [
    '## 👻 GHOST — 0 Practice Vids',
    '',
    "> *" + ghosts.length + " ninjas haven't posted yet. You know who you are.*",
    "> *Drop your first practice vid in #practice-videos and join the ranks!*",
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '### 📊 How Rankings Work',
    '- Post practice videos in #practice-videos → your count goes up → your rank goes up',
    '- **🔥 Elite Jōnin** = 50+ practice vids',
    '- **⭐ Chūnin** = 20+ practice vids',
    '- **🌱 Genin** = 1+ practice vids',
    '- **👻 Ghost** = 0 practice vids',
    '- Inactive for 2+ months? You keep your rank but get marked 💤',
  ];
  if (previewUrl) {
    msg3Lines.push('');
    msg3Lines.push('### 🖥️ Full Interactive Dashboard');
    msg3Lines.push('Sort, filter, and search the complete rankings:');
    msg3Lines.push('<' + previewUrl + '>');
  }
  msg3Lines.push('');
  msg3Lines.push("> *Every video counts. Every rep matters. Don't stop drumming.* 🥁");

  return {
    channelId: state.channelId,
    stats: { elite: elite.length, chunin: chunin.length, genin: genin.length, ghost: ghosts.length, totalVids },
    messages: {
      header: { id: state.messages.header, content: msg1Lines.join('\n') },
      genin: { id: state.messages.genin, content: msg2Lines.join('\n') },
      footer: { id: state.messages.footer, content: msg3Lines.join('\n') },
    },
  };
}

module.exports = { generateRankings, flag, formatLine };
