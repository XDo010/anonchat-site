/**
 * ⬡ AnonChat — IMPROVED SINGLE FILE
 *
 * CHANGES FROM PREVIOUS VERSION:
 *  1. New landing page with headline, features, create/join buttons
 *  2. Better layout — chat center, video section larger on right
 *  3. Video UI — bigger, participant names, mute/cam/leave/fullscreen
 *  4. Game request system — invite → accept/decline popup → play
 *  5. Added Connect 4 game alongside Tic Tac Toe
 *  6. Typing indicator ("User is typing…")
 *  7. Better message bubbles, emoji picker, auto-scroll
 *  8. Mobile responsive
 *
 * HOW TO RUN:
 *   npm init -y && npm install express socket.io
 *   node server.js
 *   Open: http://localhost:3000
 */

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY DATA
// ─────────────────────────────────────────────────────────────────────────────
const rooms = {};
const users = {};

function ts() { return new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
function roomUsers(name) { return (rooms[name]?.users || []).map(u => ({ id: u.id, username: u.username })); }

// Tic Tac Toe winner check
function checkTTT(board) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines)
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return null;
}

// Connect 4 winner check
function checkC4(board) {
  const R=6, C=7, g=(r,c)=>board[r*C+c];
  for(let r=0;r<R;r++) for(let c=0;c<=C-4;c++) { const v=g(r,c); if(v&&v===g(r,c+1)&&v===g(r,c+2)&&v===g(r,c+3)) return v; }
  for(let r=0;r<=R-4;r++) for(let c=0;c<C;c++) { const v=g(r,c); if(v&&v===g(r+1,c)&&v===g(r+2,c)&&v===g(r+3,c)) return v; }
  for(let r=0;r<=R-4;r++) for(let c=0;c<=C-4;c++) { const v=g(r,c); if(v&&v===g(r+1,c+1)&&v===g(r+2,c+2)&&v===g(r+3,c+3)) return v; }
  for(let r=0;r<=R-4;r++) for(let c=3;c<C;c++) { const v=g(r,c); if(v&&v===g(r+1,c-1)&&v===g(r+2,c-2)&&v===g(r+3,c-3)) return v; }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('create-room', ({ roomName, password, maxUsers }, cb) => {
    if (!roomName || !password) return cb({ success:false, error:'Name and password required.' });
    if (rooms[roomName])        return cb({ success:false, error:'Room already exists.' });
    const max = parseInt(maxUsers, 10);
    if (isNaN(max) || max < 2 || max > 20) return cb({ success:false, error:'Max users: 2-20.' });
    rooms[roomName] = { password, maxUsers:max, users:[], game:null };
    cb({ success:true });
  });

  socket.on('join-room', ({ roomName, password, username }, cb) => {
    const room = rooms[roomName];
    if (!room)                              return cb({ success:false, error:'Room not found.' });
    if (room.password !== password)         return cb({ success:false, error:'Wrong password.' });
    if (room.users.length >= room.maxUsers) return cb({ success:false, error:'Room is full.' });
    if (room.users.some(u=>u.username===username)) return cb({ success:false, error:'Username taken in this room.' });
    room.users.push({ id:socket.id, username });
    users[socket.id] = { username, roomName };
    socket.join(roomName);
    socket.to(roomName).emit('user-joined', { userId:socket.id, username });
    io.to(roomName).emit('system-message', { text:`${username} joined the room`, timestamp:ts() });
    cb({ success:true, users:roomUsers(roomName), game:room.game, maxUsers:room.maxUsers });
    io.to(roomName).emit('users-update', roomUsers(roomName));
  });

  socket.on('send-message', ({ message }) => {
    const u = users[socket.id];
    if (!u || !message?.trim()) return;
    io.to(u.roomName).emit('new-message', { userId:socket.id, username:u.username, message:message.trim(), timestamp:ts() });
  });

  // Typing indicator - relay to room except sender
  socket.on('typing', ({ isTyping }) => {
    const u = users[socket.id]; if (!u) return;
    socket.to(u.roomName).emit('user-typing', { userId:socket.id, username:u.username, isTyping });
  });

  // WebRTC signaling
  socket.on('webrtc-offer',         ({ offer,     targetId }) => io.to(targetId).emit('webrtc-offer',         { offer,     fromId:socket.id }));
  socket.on('webrtc-answer',        ({ answer,    targetId }) => io.to(targetId).emit('webrtc-answer',        { answer,    fromId:socket.id }));
  socket.on('webrtc-ice-candidate', ({ candidate, targetId }) => io.to(targetId).emit('webrtc-ice-candidate', { candidate, fromId:socket.id }));

  // Game invite
  socket.on('game-invite', ({ targetId, gameType }) => {
    const u = users[socket.id]; if (!u) return;
    io.to(targetId).emit('game-invite', { fromId:socket.id, fromName:u.username, gameType });
  });

  // Game invite response
  socket.on('game-invite-response', ({ fromId, accepted, gameType }) => {
    const u = users[socket.id]; if (!u) return;
    if (!accepted) { io.to(fromId).emit('game-invite-declined', { byName:u.username }); return; }
    const room = rooms[u.roomName]; if (!room) return;
    const isC4 = gameType === 'c4';
    room.game = {
      type: isC4 ? 'c4' : 'ttt',
      board: Array(isC4 ? 42 : 9).fill(null),
      players: [fromId, socket.id],
      currentTurn: fromId, active: true, winner: null
    };
    io.to(u.roomName).emit('game-started', { game:room.game, playerNames:[users[fromId]?.username||'?', u.username] });
  });

  // Game move
  socket.on('game-move', ({ index }) => {
    const u = users[socket.id]; if (!u) return;
    const room = rooms[u.roomName]; if (!room?.game?.active) return;
    const g = room.game;
    if (g.currentTurn !== socket.id || g.board[index] !== null) return;
    const sym = g.players.indexOf(socket.id) === 0 ? 'R' : 'Y';
    g.board[index] = sym;
    const winner = g.type === 'c4' ? checkC4(g.board) : checkTTT(g.board);
    if (winner) {
      g.active=false; g.winner=socket.id;
      io.to(u.roomName).emit('game-state', g);
      io.to(u.roomName).emit('game-over', { winnerId:socket.id, winnerName:u.username, isDraw:false });
    } else if (g.board.every(c=>c!==null)) {
      g.active=false; g.winner='draw';
      io.to(u.roomName).emit('game-state', g);
      io.to(u.roomName).emit('game-over', { isDraw:true });
    } else {
      g.currentTurn = g.players[1 - g.players.indexOf(socket.id)];
      io.to(u.roomName).emit('game-state', g);
    }
  });

  socket.on('game-reset', () => {
    const u = users[socket.id]; if (!u) return;
    const room = rooms[u.roomName]; if (!room) return;
    room.game = null;
    io.to(u.roomName).emit('game-closed');
  });

  socket.on('disconnect', () => {
    const u = users[socket.id]; if (!u) return;
    const room = rooms[u.roomName];
    if (room) {
      room.users = room.users.filter(x=>x.id!==socket.id);
      if (room.game?.players.includes(socket.id)) { room.game=null; io.to(u.roomName).emit('game-closed'); }
      if (room.users.length === 0) { delete rooms[u.roomName]; }
      else {
        io.to(u.roomName).emit('user-left',      { userId:socket.id, username:u.username });
        io.to(u.roomName).emit('system-message', { text:`${u.username} left`, timestamp:ts() });
        io.to(u.roomName).emit('users-update',   roomUsers(u.roomName));
      }
    }
    delete users[socket.id];
  });
});

app.get('/', (req, res) => res.send(HTML));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n⬡ AnonChat → http://localhost:${PORT}\n`));

// ─────────────────────────────────────────────────────────────────────────────
// FRONTEND
// ─────────────────────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>AnonChat — Private Rooms</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<style>
:root{
  --bg:#0a0e1a;--bg2:#0f1524;--bg3:#151d30;--bg4:#1c2640;
  --border:#ffffff12;--border2:#ffffff22;
  --cyan:#00d4ff;--cyan2:#0099cc;
  --purple:#7c3aed;--purple2:#6d28d9;
  --green:#10b981;--red:#ef4444;--yellow:#f59e0b;
  --text:#f0f4ff;--text2:#8899bb;--text3:#4a5878;
  --r4:4px;--r8:8px;--r12:12px;--r16:16px;--r24:24px;
  --shadow:0 4px 24px #00000060;--shadowlg:0 8px 48px #00000080;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;overflow:hidden}
button{cursor:pointer;border:none;background:none;font-family:inherit}
input,textarea{font-family:inherit}
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:10px}
.hidden{display:none!important}

/* ── Screens ── */
.screen{display:none;position:fixed;inset:0;z-index:1}
.screen.active{display:flex}
#screen-landing{flex-direction:column;overflow-y:auto;overflow-x:hidden}

/* ── Background ── */
.bg-deco{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.bg-grid{position:absolute;inset:0;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:52px 52px;opacity:.5}
.blob{position:absolute;border-radius:50%;filter:blur(100px);opacity:.12;animation:bpulse 10s ease-in-out infinite alternate}
.b1{width:600px;height:600px;background:var(--cyan);top:-200px;left:-150px}
.b2{width:500px;height:500px;background:var(--purple);bottom:-150px;right:-100px;animation-delay:4s}
@keyframes bpulse{from{opacity:.08;transform:scale(1)}to{opacity:.2;transform:scale(1.2)}}

/* ── Buttons ── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:11px 22px;border-radius:var(--r8);font-weight:600;font-size:.88rem;transition:all .18s;white-space:nowrap}
.btn-p{background:linear-gradient(135deg,var(--cyan),var(--cyan2));color:var(--bg);box-shadow:0 0 20px #00d4ff25}
.btn-p:hover{transform:translateY(-2px);box-shadow:0 0 32px #00d4ff45}
.btn-s{background:transparent;color:var(--text);border:1.5px solid var(--border2)}
.btn-s:hover{border-color:var(--cyan);color:var(--cyan)}
.btn-pu{background:linear-gradient(135deg,var(--purple),var(--purple2));color:#fff}
.btn-pu:hover{transform:translateY(-2px);box-shadow:0 0 24px #7c3aed40}
.btn-d{background:var(--red);color:#fff}
.btn-d:hover{background:#dc2626}
.btn-g{color:var(--text2);border:1px solid var(--border)}
.btn-g:hover{border-color:var(--cyan);color:var(--cyan)}
.btn-sm{padding:6px 14px;font-size:.78rem}
.btn-xs{padding:4px 10px;font-size:.72rem}
.btn-w{width:100%}
.ibt{width:36px;height:36px;border-radius:var(--r8);display:flex;align-items:center;justify-content:center;background:var(--bg4);border:1px solid var(--border);font-size:.95rem;transition:all .18s;cursor:pointer}
.ibt:hover{border-color:var(--cyan)}
.ibt.on{background:var(--red);border-color:var(--red)}

/* ── Form inputs ── */
.fg{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.fg label{font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text2)}
.fi{background:var(--bg2);border:1.5px solid var(--border);color:var(--text);padding:11px 14px;border-radius:var(--r8);font-size:.9rem;outline:none;transition:all .18s;width:100%}
.fi:focus{border-color:var(--cyan);box-shadow:0 0 0 3px #00d4ff12}
.fi::placeholder{color:var(--text3)}
.errmsg{font-size:.78rem;color:var(--red);min-height:16px;margin-bottom:6px}

/* ════════════════════════════════
   LANDING PAGE
════════════════════════════════ */
.nav{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:16px 48px;background:#0a0e1acc;backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.logo{display:flex;align-items:center;gap:10px}
.logo-i{font-size:1.5rem;filter:drop-shadow(0 0 10px var(--cyan))}
.logo-t{font-size:1.15rem;font-weight:700;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.nav-acts{display:flex;gap:10px}

.hero{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:100px 24px 80px;min-height:80vh}
.hero-badge{display:inline-flex;align-items:center;gap:8px;background:#00d4ff12;border:1px solid #00d4ff28;border-radius:100px;padding:6px 16px;font-size:.75rem;font-weight:600;color:var(--cyan);letter-spacing:.06em;text-transform:uppercase;margin-bottom:28px;animation:fup .6s ease both}
.blink-dot{width:6px;height:6px;border-radius:50%;background:var(--cyan);box-shadow:0 0 8px var(--cyan);animation:blink 1.5s ease infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
.hero h1{font-size:clamp(2.2rem,6vw,4.2rem);font-weight:800;line-height:1.1;letter-spacing:-.03em;margin-bottom:22px;animation:fup .6s .1s ease both}
.hero h1 span{background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hero p{font-size:clamp(.95rem,2vw,1.15rem);color:var(--text2);max-width:540px;line-height:1.7;margin-bottom:38px;animation:fup .6s .2s ease both}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;animation:fup .6s .3s ease both}
.hero-cta .btn{padding:14px 30px;font-size:.95rem;border-radius:var(--r12)}
@keyframes fup{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}

.features{position:relative;z-index:2;padding:80px 48px;max-width:1080px;margin:0 auto;width:100%}
.sec-title{text-align:center;font-size:1.75rem;font-weight:700;margin-bottom:10px}
.sec-sub{text-align:center;color:var(--text2);margin-bottom:50px;font-size:.95rem}
.feat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px}
.feat-card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r16);padding:26px 22px;transition:all .25s}
.feat-card:hover{border-color:var(--border2);transform:translateY(-3px);box-shadow:var(--shadow)}
.feat-icon{font-size:1.9rem;margin-bottom:14px}
.feat-title{font-size:.95rem;font-weight:600;margin-bottom:7px}
.feat-desc{font-size:.82rem;color:var(--text2);line-height:1.6}

.how{position:relative;z-index:2;padding:80px 48px;background:var(--bg2)}
.how-inner{max-width:720px;margin:0 auto;text-align:center}
.steps{display:flex;gap:0;justify-content:center;flex-wrap:wrap;margin-top:40px}
.step{flex:1;min-width:150px;padding:16px;text-align:center}
.step-n{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--purple));display:flex;align-items:center;justify-content:center;font-weight:700;margin:0 auto 12px}
.step-t{font-weight:600;margin-bottom:5px;font-size:.9rem}
.step-d{font-size:.78rem;color:var(--text2)}

.footer{position:relative;z-index:2;text-align:center;padding:28px;border-top:1px solid var(--border);color:var(--text3);font-size:.8rem}

/* ════════════════════════════════
   AUTH MODAL
════════════════════════════════ */
#screen-auth{align-items:center;justify-content:center;background:#00000088;backdrop-filter:blur(8px)}
.auth-box{position:relative;z-index:2;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r24);padding:34px 30px;width:100%;max-width:410px;margin:16px;box-shadow:var(--shadowlg);animation:min .3s cubic-bezier(.16,1,.3,1)}
@keyframes min{from{opacity:0;transform:scale(.95) translateY(12px)}to{opacity:1;transform:scale(1) translateY(0)}}
.auth-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}
.auth-title{font-size:1.15rem;font-weight:700}
.auth-back{color:var(--text2);font-size:.85rem;cursor:pointer}
.auth-back:hover{color:var(--cyan)}
.tabs-row{display:flex;gap:4px;background:var(--bg);border-radius:var(--r8);padding:4px;margin-bottom:22px}
.tab-b{flex:1;padding:9px;border-radius:var(--r4);font-size:.84rem;font-weight:600;color:var(--text2);transition:all .18s}
.tab-b.on{background:var(--bg3);color:var(--cyan)}

/* ════════════════════════════════
   ROOM SCREEN
════════════════════════════════ */
#screen-room{flex-direction:row}
.room-wrap{display:flex;width:100%;height:100vh;overflow:hidden}

/* Sidebar */
.sb{width:210px;flex-shrink:0;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.sb-head{padding:14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.sb-room{padding:12px 14px;border-bottom:1px solid var(--border)}
.sb-room-lbl{font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);margin-bottom:3px}
.sb-room-name{font-size:.9rem;font-weight:700;color:var(--cyan);font-family:'Space Grotesk',monospace;word-break:break-all;margin-bottom:4px}
.sb-room-cnt{font-size:.72rem;color:var(--text2)}
.sb-members{flex:1;overflow-y:auto;padding:8px}
.sb-members-lbl{font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text3);padding:3px 4px;margin-bottom:5px}
.mi{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:var(--r8);font-size:.82rem;transition:background .15s}
.mi:hover{background:var(--bg3)}
.mi.me{color:var(--cyan)}
.mav{width:26px;height:26px;border-radius:50%;background:var(--bg4);border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:.68rem;font-weight:700;color:var(--text2);flex-shrink:0;text-transform:uppercase}
.mi.me .mav{border-color:var(--cyan);color:var(--cyan)}
.macts{margin-left:auto}
.gi-btn{font-size:.62rem;padding:2px 6px;border-radius:3px;background:var(--bg4);border:1px solid var(--border);color:var(--text2);cursor:pointer;transition:all .15s}
.gi-btn:hover{border-color:var(--purple);color:var(--purple)}
.sb-foot{padding:10px 14px;border-top:1px solid var(--border)}
.you-row{display:flex;align-items:center;gap:7px;font-size:.8rem;color:var(--text2)}
.ydot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green)}
.ytag{font-size:.6rem;background:#10b98118;color:var(--green);border:1px solid #10b98138;border-radius:3px;padding:1px 5px;font-weight:700}

/* Chat column */
.cc{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg);border-right:1px solid var(--border)}
.cc-head{padding:13px 18px;border-bottom:1px solid var(--border);background:var(--bg2);display:flex;align-items:center;gap:10px;flex-shrink:0}
.cc-title{font-weight:600;flex:1}
.msgs{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:2px}
.sys-msg{text-align:center;font-size:.7rem;color:var(--text3);padding:7px 0;font-family:'Space Grotesk',monospace}
.mb{display:flex;flex-direction:column;max-width:74%;animation:mi2 .22s ease}
.mb.own{align-self:flex-end;align-items:flex-end}
.mb.oth{align-self:flex-start;align-items:flex-start}
@keyframes mi2{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
.mm{display:flex;align-items:baseline;gap:7px;margin-bottom:3px;padding:0 4px}
.ma{font-size:.7rem;font-weight:600;color:var(--cyan)}
.mb.own .ma{color:var(--purple)}
.mt{font-size:.62rem;color:var(--text3)}
.mbub{background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:9px 13px;font-size:.875rem;line-height:1.55;word-break:break-word;white-space:pre-wrap}
.mb.own .mbub{background:var(--bg4);border-color:#ffffff16}
.typing-bar{padding:5px 16px;min-height:26px;flex-shrink:0;font-size:.73rem;color:var(--text3);font-style:italic}
.tdots span{display:inline-block;width:4px;height:4px;border-radius:50%;background:var(--text3);margin:0 1px;animation:td .8s ease infinite}
.tdots span:nth-child(2){animation-delay:.15s}
.tdots span:nth-child(3){animation-delay:.3s}
@keyframes td{0%,80%,100%{transform:scale(.8);opacity:.4}40%{transform:scale(1.2);opacity:1}}
.composer{padding:11px 14px;border-top:1px solid var(--border);background:var(--bg2);display:flex;align-items:flex-end;gap:7px;position:relative;flex-shrink:0}
.cinput{flex:1;background:var(--bg);border:1.5px solid var(--border);color:var(--text);padding:10px 13px;border-radius:var(--r12);font-size:.875rem;resize:none;outline:none;max-height:108px;line-height:1.5;transition:border-color .18s}
.cinput:focus{border-color:var(--cyan)}
.etog{font-size:1.15rem;padding:9px;border-radius:var(--r8);background:var(--bg);border:1.5px solid var(--border);line-height:1;flex-shrink:0;transition:all .18s}
.etog:hover{border-color:var(--cyan);transform:scale(1.08)}
.sbtn{width:40px;height:40px;flex-shrink:0;border-radius:var(--r8);font-size:1.1rem}
.epanel{position:absolute;bottom:68px;left:10px;background:var(--bg3);border:1px solid var(--border2);border-radius:var(--r12);padding:9px;display:flex;flex-wrap:wrap;gap:3px;width:265px;max-height:185px;overflow-y:auto;box-shadow:var(--shadowlg);z-index:50;animation:min .2s ease}
.epanel::-webkit-scrollbar{width:3px}
.ebtn{font-size:1.2rem;padding:4px;border-radius:5px;line-height:1}
.ebtn:hover{background:var(--bg4);transform:scale(1.18)}

/* Right col */
.rc{width:340px;flex-shrink:0;background:var(--bg2);display:flex;flex-direction:column;overflow:hidden;transition:width .3s}
.rc.big{width:430px}
.ph{padding:11px 14px;display:flex;align-items:center;justify-content:space-between;font-size:.8rem;font-weight:600;background:var(--bg3);border-bottom:1px solid var(--border);flex-shrink:0}

/* Video */
.vsec{flex:2;display:flex;flex-direction:column;min-height:0;border-bottom:1px solid var(--border)}
.vsec.big{flex:3}
.vctrl{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap}
.frow{display:flex;align-items:center;gap:4px;padding:5px 10px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap}
.flbl{font-size:.63rem;color:var(--text3);font-weight:600;letter-spacing:.06em;margin-right:3px}
.fc{font-size:.68rem;padding:3px 8px;border-radius:4px;border:1px solid var(--border);color:var(--text2);background:var(--bg3);transition:all .15s;cursor:pointer}
.fc:hover{border-color:var(--cyan2);color:var(--cyan)}
.fc.on{border-color:var(--cyan);color:var(--cyan);background:#00d4ff12}
.vgrid{flex:1;overflow-y:auto;padding:7px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:5px;align-content:start}
.vempty{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px;color:var(--text3);font-size:.78rem;text-align:center}
.vempty-i{font-size:1.9rem;opacity:.35}
.vcrd{position:relative;border-radius:var(--r8);overflow:hidden;background:#000;aspect-ratio:4/3;border:1.5px solid var(--border)}
.vcrd.local{border-color:var(--cyan)}
.vcrd video{width:100%;height:100%;object-fit:cover;display:block}
.vname{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,#000000a0);color:#fff;font-size:.63rem;padding:7px 6px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.call-ctls{display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 10px;flex-shrink:0;border-top:1px solid var(--border)}
.ccbt{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.95rem;background:var(--bg4);border:1.5px solid var(--border);transition:all .18s;cursor:pointer}
.ccbt:hover{background:var(--bg3);border-color:var(--border2)}
.ccbt.muted,.ccbt.camoff{background:var(--red);border-color:var(--red)}
.ccbt.start{background:var(--green);border-color:var(--green);width:44px;height:44px;font-size:1.1rem}
.ccbt.end{background:var(--red);border-color:var(--red);width:44px;height:44px;font-size:1.1rem}

/* Game */
.gsec{flex:1.2;display:flex;flex-direction:column;min-height:0}
.gempty{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:8px;color:var(--text3);font-size:.8rem;text-align:center;padding:18px}
.gempty-i{font-size:1.9rem;opacity:.4}

/* TTT */
.ttt-w{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;gap:9px;overflow:auto}
.ttt-s{font-size:.8rem;color:var(--text2);text-align:center;font-family:'Space Grotesk',monospace}
.ttt-s.yt{color:var(--cyan);font-weight:600}
.ttt-s.win{color:var(--yellow);font-weight:700}
.ttt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;width:176px}
.tc{aspect-ratio:1;background:var(--bg3);border:1.5px solid var(--border);border-radius:var(--r8);display:flex;align-items:center;justify-content:center;font-size:1.45rem;font-weight:700;cursor:pointer;transition:all .15s;font-family:'Space Grotesk',monospace}
.tc:hover:not(.f){border-color:var(--cyan);background:#00d4ff0e}
.tc.f{cursor:default}
.tc.rx{color:var(--cyan);text-shadow:0 0 10px var(--cyan)}
.tc.ry{color:var(--purple);text-shadow:0 0 10px var(--purple)}
.tc.wn{border-color:var(--yellow);background:#f59e0b12}

/* C4 */
.c4-w{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px;gap:8px;overflow:auto}
.c4-s{font-size:.8rem;color:var(--text2);text-align:center;font-family:'Space Grotesk',monospace}
.c4-s.yt{color:var(--cyan);font-weight:600}
.c4-s.win{color:var(--yellow);font-weight:700}
.c4-board{background:var(--purple2);border-radius:var(--r8);padding:6px;display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.c4-col{display:flex;flex-direction:column;gap:4px;cursor:pointer;border-radius:4px;padding:2px}
.c4-col:hover .c4-cell:first-child{opacity:.7}
.c4-cell{width:30px;height:30px;border-radius:50%;background:var(--bg);border:2px solid #ffffff18;transition:background .2s}
.c4-cell.rx{background:#ef4444;border-color:#fca5a5;box-shadow:0 0 6px #ef444470}
.c4-cell.ry{background:var(--yellow);border-color:#fde68a;box-shadow:0 0 6px #f59e0b70}
.c4-cell.wn{border-color:#fff;box-shadow:0 0 10px #fff}

/* Invite popup */
.pop-ov{position:fixed;inset:0;z-index:500;background:#00000075;display:flex;align-items:center;justify-content:center;animation:fi .2s ease}
@keyframes fi{from{opacity:0}to{opacity:1}}
.pop-box{background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r16);padding:26px 22px;max-width:320px;width:90%;text-align:center;box-shadow:var(--shadowlg);animation:min .25s ease}
.pop-icon{font-size:2.4rem;margin-bottom:10px}
.pop-title{font-size:1.05rem;font-weight:700;margin-bottom:7px}
.pop-desc{font-size:.82rem;color:var(--text2);margin-bottom:18px;line-height:1.5}
.pop-acts{display:flex;gap:9px;justify-content:center}

/* Toast */
.toast-ct{position:fixed;bottom:18px;right:18px;z-index:9999;display:flex;flex-direction:column;gap:7px}
.toast{background:var(--bg3);border:1px solid var(--border2);color:var(--text);padding:11px 16px;border-radius:var(--r8);font-size:.82rem;box-shadow:var(--shadow);animation:tin .3s ease;display:flex;align-items:center;gap:7px}
@keyframes tin{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:translateX(0)}}
.toast.ok{border-color:var(--green)}
.toast.err{border-color:var(--red)}
.toast.inf{border-color:var(--cyan)}

@media(max-width:900px){.rc{width:290px}.rc.big{width:360px}}
@media(max-width:700px){.rc{display:none}.rc.mob{display:flex;position:fixed;inset:0;z-index:200;width:100%}}
@media(max-width:500px){.sb{display:none}}
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════
     LANDING PAGE
═══════════════════════════════════════════ -->
<div id="screen-landing" class="screen active">
  <div class="bg-deco"><div class="bg-grid"></div><div class="blob b1"></div><div class="blob b2"></div></div>

  <nav class="nav">
    <div class="logo"><span class="logo-i">⬡</span><span class="logo-t">AnonChat</span></div>
    <div class="nav-acts">
      <button class="btn btn-g btn-sm" onclick="openAuth('join')">Join Room</button>
      <button class="btn btn-p btn-sm" onclick="openAuth('create')">Create Room</button>
    </div>
  </nav>

  <section class="hero">
    <div class="hero-badge"><span class="blink-dot"></span>No sign-up required</div>
    <h1>Private Rooms.<br/><span>Real Conversations.</span></h1>
    <p>Create a private room and chat, play games, or video call with friends — no email, no password, completely anonymous.</p>
    <div class="hero-cta">
      <button class="btn btn-p" onclick="openAuth('create')">🚀 Create a Room</button>
      <button class="btn btn-s" onclick="openAuth('join')">🔑 Join a Room</button>
    </div>
  </section>

  <section class="features">
    <h2 class="sec-title">Everything you need to connect</h2>
    <p class="sec-sub">No accounts. No tracking. Just rooms.</p>
    <div class="feat-grid">
      <div class="feat-card"><div class="feat-icon">🔒</div><div class="feat-title">Private Chat Rooms</div><div class="feat-desc">Password-protected rooms. Only people with the password can enter.</div></div>
      <div class="feat-card"><div class="feat-icon">📹</div><div class="feat-title">Video Calls + Filters</div><div class="feat-desc">Peer-to-peer video with WebRTC. Apply grayscale, blur, sepia and more.</div></div>
      <div class="feat-card"><div class="feat-icon">🎮</div><div class="feat-title">Play Games Together</div><div class="feat-desc">Challenge roommates to Tic Tac Toe or Connect 4 without leaving the chat.</div></div>
      <div class="feat-card"><div class="feat-icon">✉️</div><div class="feat-title">No Email Required</div><div class="feat-desc">Just pick a username and start chatting. Nothing stored, nothing tracked.</div></div>
    </div>
  </section>

  <section class="how">
    <div class="how-inner">
      <h2 class="sec-title">How it works</h2>
      <p class="sec-sub">Three steps to start chatting</p>
      <div class="steps">
        <div class="step"><div class="step-n">1</div><div class="step-t">Pick a username</div><div class="step-d">No account needed</div></div>
        <div class="step"><div class="step-n">2</div><div class="step-t">Create or join a room</div><div class="step-d">Password protected</div></div>
        <div class="step"><div class="step-n">3</div><div class="step-t">Chat, call, play</div><div class="step-d">All in one place</div></div>
      </div>
    </div>
  </section>
  <footer class="footer">© 2025 AnonChat — Private by design.</footer>
</div>

<!-- ═══════════════════════════════════════════
     AUTH SCREEN
═══════════════════════════════════════════ -->
<div id="screen-auth" class="screen">
  <div class="bg-deco"><div class="bg-grid"></div><div class="blob b1"></div><div class="blob b2"></div></div>
  <div class="auth-box">
    <div class="auth-head">
      <div class="logo"><span class="logo-i" style="font-size:1.2rem">⬡</span><span class="logo-t" style="font-size:.95rem">AnonChat</span></div>
      <span class="auth-back" onclick="showScreen('landing')">← Back</span>
    </div>
    <div class="fg">
      <label>Your Username</label>
      <input id="inp-un" class="fi" type="text" placeholder="e.g. shadow_fox" maxlength="20" autocomplete="off"/>
    </div>
    <div class="tabs-row">
      <button class="tab-b on" id="tbc" onclick="switchTab('c')">Create Room</button>
      <button class="tab-b" id="tbj" onclick="switchTab('j')">Join Room</button>
    </div>
    <!-- Create -->
    <div id="tc">
      <div class="fg"><label>Room Name</label><input id="crn" class="fi" type="text" placeholder="e.g. shadow_lounge" maxlength="30" autocomplete="off"/></div>
      <div class="fg"><label>Password</label><input id="crp" class="fi" type="password" placeholder="Choose a password" maxlength="40"/></div>
      <div class="fg"><label>Max Users (2–20)</label><input id="crm" class="fi" type="number" min="2" max="20" value="10"/></div>
      <div id="ce" class="errmsg"></div>
      <button id="bcr" class="btn btn-p btn-w" onclick="doCreate()">Create &amp; Enter →</button>
    </div>
    <!-- Join -->
    <div id="tj" class="hidden">
      <div class="fg"><label>Room Name</label><input id="jrn" class="fi" type="text" placeholder="Exact room name" maxlength="30" autocomplete="off"/></div>
      <div class="fg"><label>Password</label><input id="jrp" class="fi" type="password" placeholder="Room password" maxlength="40"/></div>
      <div id="je" class="errmsg"></div>
      <button id="bjr" class="btn btn-p btn-w" onclick="doJoin()">Join Room →</button>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════
     ROOM SCREEN
═══════════════════════════════════════════ -->
<div id="screen-room" class="screen">
  <div class="room-wrap">

    <!-- Sidebar -->
    <aside class="sb">
      <div class="sb-head">
        <div class="logo"><span class="logo-i" style="font-size:1.05rem">⬡</span><span class="logo-t" style="font-size:.85rem">AnonChat</span></div>
        <button class="btn btn-g btn-xs" id="btn-leave">Leave</button>
      </div>
      <div class="sb-room">
        <div class="sb-room-lbl">Room</div>
        <div id="dsp-rname" class="sb-room-name"></div>
        <div id="dsp-rcnt" class="sb-room-cnt">0 / 0</div>
      </div>
      <div class="sb-members">
        <div class="sb-members-lbl">Members</div>
        <div id="mlist"></div>
      </div>
      <div class="sb-foot">
        <div class="you-row"><span class="ydot"></span><span id="dsp-myname"></span><span class="ytag">YOU</span></div>
      </div>
    </aside>

    <!-- Chat -->
    <div class="cc">
      <div class="cc-head">
        <span>💬</span><span class="cc-title">Chat</span>
        <button class="btn btn-g btn-sm" onclick="document.getElementById('rc').classList.toggle('mob')">📹 Video</button>
      </div>
      <div id="msgs" class="msgs"></div>
      <div id="tbar" class="typing-bar"></div>
      <div class="composer">
        <button class="etog" id="etog">😊</button>
        <div id="ep" class="epanel hidden"></div>
        <textarea id="minput" class="cinput" placeholder="Type a message…" rows="1" maxlength="1000"></textarea>
        <button id="bsend" class="btn btn-p sbtn">↑</button>
      </div>
    </div>

    <!-- Right panel -->
    <aside id="rc" class="rc">
      <!-- VIDEO -->
      <div id="vsec" class="vsec">
        <div class="ph">
          <span>📹 Video Call</span>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="ibt" id="btnmu" onclick="toggleMic()" title="Mute">🎤</button>
            <button class="ibt" id="btncam" onclick="toggleCam()" title="Camera">🎥</button>
            <button class="ibt" onclick="toggleFS()" title="Fullscreen">⛶</button>
          </div>
        </div>
        <div class="frow">
          <span class="flbl">Filter:</span>
          <button class="fc on" data-f="none">None</button>
          <button class="fc" data-f="grayscale(100%)">B&amp;W</button>
          <button class="fc" data-f="blur(3px)">Blur</button>
          <button class="fc" data-f="sepia(100%)">Sepia</button>
          <button class="fc" data-f="brightness(1.6)">Bright</button>
        </div>
        <div id="vgrid" class="vgrid">
          <div class="vempty"><span class="vempty-i">📷</span><p>Click Start Call to begin</p></div>
        </div>
        <div class="call-ctls">
          <button id="btn-sc" class="ccbt start" onclick="startCall()" title="Start Call">📞</button>
          <button id="btn-ec" class="ccbt end hidden" onclick="stopCall()" title="End Call">📵</button>
        </div>
      </div>
      <!-- GAME -->
      <div id="gsec" class="gsec">
        <div class="ph">
          <span>🎮 Games</span>
          <button class="btn btn-g btn-xs hidden" id="btn-cg" onclick="closeGame()">Close</button>
        </div>
        <div id="garea">
          <div class="gempty"><div class="gempty-i">🎮</div><p>Invite a member to play</p><p style="font-size:.7rem;color:var(--text3);margin-top:3px">Click 🎮 next to a name</p></div>
        </div>
      </div>
    </aside>
  </div>
</div>

<!-- Game invite popup -->
<div id="inv-pop" class="pop-ov hidden">
  <div class="pop-box">
    <div class="pop-icon">🎮</div>
    <div class="pop-title">Game Invite!</div>
    <div class="pop-desc" id="inv-desc">Someone invited you to play</div>
    <div class="pop-acts">
      <button class="btn btn-p" id="btn-acc">✓ Accept</button>
      <button class="btn btn-s" id="btn-dec">✕ Decline</button>
    </div>
  </div>
</div>

<div class="toast-ct" id="tct"></div>

<script src="/socket.io/socket.io.js"></script>
<script>
'use strict';
const socket = io();
const S = {
  username:'',roomName:'',maxUsers:10,users:[],myId:null,
  callActive:false,localStream:null,peers:{},micOn:true,camOn:true,filter:'none',
  game:null,amPlayer:false,mySym:null,
  pendingInv:null, typingUsers:{}, typingTimer:null
};

const $  = id => document.getElementById(id);
const $$ = s  => document.querySelectorAll(s);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function showScreen(n){ $$('.screen').forEach(s=>s.classList.remove('active')); $('screen-'+n).classList.add('active'); }
function openAuth(t){ showScreen('auth'); switchTab(t==='join'?'j':'c'); }
function switchTab(t){
  $('tc').classList.toggle('hidden',t!=='c'); $('tj').classList.toggle('hidden',t!=='j');
  $('tbc').classList.toggle('on',t==='c'); $('tbj').classList.toggle('on',t==='j');
}

// Toast
function toast(msg,type='inf'){
  const icons={ok:'✅',err:'❌',inf:'ℹ️'};
  const el=document.createElement('div'); el.className='toast '+type;
  el.innerHTML=icons[type]+' '+esc(msg);
  $('tct').appendChild(el); setTimeout(()=>el.remove(),3500);
}

// Emoji picker
const EMOJI=['😀','😂','🥲','😊','😎','🤔','😅','😆','🤣','😍','🥰','😘','😜','😤','😢','😭','😱','🤯','🔥','💀','💯','👍','👎','👏','🙌','🤝','👋','✌️','🤞','💪','🎉','🎊','🎮','🎲','🎯','🏆','🥇','🚀','🌙','⭐','💎','👑','🔮','🌈','💥','⚡','🌊','🍕','🍔','🍟','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕'];
(()=>{ const p=$('ep'); EMOJI.forEach(e=>{ const b=document.createElement('button'); b.className='ebtn'; b.textContent=e; b.onclick=()=>{ const t=$('minput'),pos=t.selectionStart; t.value=t.value.slice(0,pos)+e+t.value.slice(pos); t.focus(); t.selectionStart=t.selectionEnd=pos+e.length; p.classList.add('hidden'); }; p.appendChild(b); }); })();
$('etog').onclick=e=>{e.stopPropagation();$('ep').classList.toggle('hidden')};
document.onclick=()=>$('ep').classList.add('hidden');
$('ep').onclick=e=>e.stopPropagation();

// Messages
function addSys(text,ts){ const c=$('msgs'),el=document.createElement('div'); el.className='sys-msg'; el.textContent='— '+text+' — '+(ts||''); c.appendChild(el); scroll(); }
function addMsg({userId,username,message,timestamp}){
  const c=$('msgs'),own=userId===S.myId,w=document.createElement('div');
  w.className='mb '+(own?'own':'oth');
  w.innerHTML='<div class="mm"><span class="ma">'+esc(username)+'</span><span class="mt">'+timestamp+'</span></div><div class="mbub">'+esc(message)+'</div>';
  c.appendChild(w); scroll();
}
function scroll(){ const c=$('msgs'); c.scrollTop=c.scrollHeight; }

// Typing
function updateTyping(){
  const names=Object.values(S.typingUsers).filter(n=>n!==S.username);
  const b=$('tbar');
  if(!names.length){b.innerHTML='';return;}
  const lbl=names.length===1?esc(names[0])+' is typing':esc(names.slice(0,-1).join(', '))+' and '+esc(names[names.length-1])+' are typing';
  b.innerHTML=lbl+' <span class="tdots"><span></span><span></span><span></span></span>';
}

// Members
function renderMembers(users){
  const l=$('mlist'); l.innerHTML='';
  users.forEach(u=>{
    const me=u.id===S.myId,el=document.createElement('div');
    el.className='mi'+(me?' me':''); el.dataset.uid=u.id;
    const acts=me?'':\`<div class="macts"><button class="gi-btn" onclick="showInviteMenu('\${u.id}','\${esc(u.username)}')">🎮</button></div>\`;
    el.innerHTML=\`<div class="mav">\${esc(u.username[0])}</div><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${esc(u.username)}</span>\${acts}\`;
    l.appendChild(el);
  });
  $('dsp-rcnt').textContent=users.length+' / '+S.maxUsers+' online';
}

// Auth
function getUN(){ const v=$('inp-un').value.trim(); if(!v||v.length<2){toast('Username must be 2+ characters.','err');return null;} return v; }

function doCreate(){
  const un=getUN(); if(!un)return;
  const n=$('crn').value.trim(),p=$('crp').value.trim(),m=parseInt($('crm').value,10),e=$('ce');
  if(!n){e.textContent='Room name required.';return}
  if(!p){e.textContent='Password required.';return}
  if(isNaN(m)||m<2||m>20){e.textContent='Max users: 2-20.';return}
  e.textContent=''; $('bcr').textContent='Creating…'; $('bcr').disabled=true;
  socket.emit('create-room',{roomName:n,password:p,maxUsers:m},res=>{
    $('bcr').textContent='Create & Enter →'; $('bcr').disabled=false;
    if(res.success){S.username=un; enterRoom(n,p);}
    else e.textContent=res.error;
  });
}

function doJoin(){
  const un=getUN(); if(!un)return;
  const n=$('jrn').value.trim(),p=$('jrp').value.trim(),e=$('je');
  if(!n){e.textContent='Room name required.';return}
  if(!p){e.textContent='Password required.';return}
  e.textContent=''; $('bjr').textContent='Joining…'; $('bjr').disabled=true;
  S.username=un; enterRoom(n,p);
}

function enterRoom(roomName,password){
  socket.emit('join-room',{roomName,password,username:S.username},res=>{
    $('bjr').textContent='Join Room →'; $('bjr').disabled=false;
    $('bcr').textContent='Create & Enter →'; $('bcr').disabled=false;
    if(!res.success){$('je').textContent=res.error;$('ce').textContent=res.error;return;}
    S.roomName=roomName; S.maxUsers=res.maxUsers; S.users=res.users; S.myId=socket.id;
    $('dsp-rname').textContent=roomName; $('dsp-myname').textContent=S.username;
    renderMembers(S.users);
    if(res.game) applyGame(res.game);
    showScreen('room');
    toast('Welcome to '+roomName+'! 🎉','ok');
  });
}

$('btn-leave').onclick=()=>{
  stopCall(); socket.disconnect(); socket.connect();
  S.users=[]; S.game=null; S.amPlayer=false;
  $('msgs').innerHTML=''; $('mlist').innerHTML=''; $('tbar').innerHTML='';
  resetGameArea(); showScreen('landing');
};

// Send message
function sendMsg(){
  const inp=$('minput'),msg=inp.value.trim(); if(!msg)return;
  socket.emit('send-message',{message:msg});
  socket.emit('typing',{isTyping:false});
  inp.value=''; inp.style.height='auto'; inp.focus();
}
$('bsend').onclick=sendMsg;
$('minput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}};
$('minput').oninput=function(){
  this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,108)+'px';
  socket.emit('typing',{isTyping:true});
  clearTimeout(S.typingTimer); S.typingTimer=setTimeout(()=>socket.emit('typing',{isTyping:false}),1800);
};

// ── WebRTC ──────────────────────────────────────────────────────────────
const ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};

async function startCall(){
  if(S.callActive)return;
  try{
    S.localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    S.callActive=true; addLocalVid(); applyFilter(S.filter);
    S.users.forEach(u=>{if(u.id!==S.myId)makeOffer(u.id);});
    $('btn-sc').classList.add('hidden'); $('btn-ec').classList.remove('hidden');
    $('vsec').classList.add('big'); $('rc').classList.add('big');
    toast('Video call started! 📹','ok');
  }catch(e){toast('Could not access camera/microphone.','err');}
}

function stopCall(){
  if(!S.callActive)return; S.callActive=false;
  S.localStream?.getTracks().forEach(t=>t.stop()); S.localStream=null;
  Object.values(S.peers).forEach(p=>p.close()); S.peers={};
  $('vgrid').innerHTML='<div class="vempty"><span class="vempty-i">📷</span><p>Click Start Call to begin</p></div>';
  $('btn-sc').classList.remove('hidden'); $('btn-ec').classList.add('hidden');
  $('vsec').classList.remove('big'); $('rc').classList.remove('big');
  toast('Call ended.');
}

function addLocalVid(){
  const g=$('vgrid'); g.querySelector('.vempty')?.remove(); document.getElementById('vl')?.remove();
  const w=document.createElement('div'); w.className='vcrd local'; w.id='vl';
  const v=document.createElement('video'); v.srcObject=S.localStream; v.autoplay=true; v.muted=true; v.playsInline=true;
  const n=document.createElement('div'); n.className='vname'; n.textContent=S.username+' (you)';
  w.appendChild(v); w.appendChild(n); g.appendChild(w);
}

function addRemoteVid(uid,uname,stream){
  const g=$('vgrid'); g.querySelector('.vempty')?.remove(); document.getElementById('vr'+uid)?.remove();
  const w=document.createElement('div'); w.className='vcrd'; w.id='vr'+uid;
  const v=document.createElement('video'); v.srcObject=stream; v.autoplay=true; v.playsInline=true;
  const n=document.createElement('div'); n.className='vname'; n.textContent=uname;
  w.appendChild(v); w.appendChild(n); g.appendChild(w);
}

function removeRemoteVid(uid){
  document.getElementById('vr'+uid)?.remove();
  const g=$('vgrid'); if(!g.querySelector('.vcrd')) g.innerHTML='<div class="vempty"><span class="vempty-i">📷</span><p>Click Start Call to begin</p></div>';
}

function makeOffer(tid){
  const pc=makePeer(tid);
  S.localStream?.getTracks().forEach(t=>pc.addTrack(t,S.localStream));
  pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>socket.emit('webrtc-offer',{offer:pc.localDescription,targetId:tid})).catch(console.error);
}

function makePeer(pid){
  S.peers[pid]?.close();
  const pc=new RTCPeerConnection(ICE); S.peers[pid]=pc;
  pc.onicecandidate=e=>{if(e.candidate)socket.emit('webrtc-ice-candidate',{candidate:e.candidate,targetId:pid});};
  pc.ontrack=e=>{const u=S.users.find(u=>u.id===pid);addRemoteVid(pid,u?.username||'Remote',e.streams[0]);};
  pc.onconnectionstatechange=()=>{if(['disconnected','failed','closed'].includes(pc.connectionState)){removeRemoteVid(pid);delete S.peers[pid];}};
  return pc;
}

function toggleMic(){
  const t=S.localStream?.getAudioTracks()[0];if(!t)return;
  S.micOn=!S.micOn; t.enabled=S.micOn;
  $('btnmu').classList.toggle('on',!S.micOn);
  $('btnmu').textContent=S.micOn?'🎤':'🔇';
  toast(S.micOn?'Mic on':'Mic muted');
}

function toggleCam(){
  const t=S.localStream?.getVideoTracks()[0];if(!t)return;
  S.camOn=!S.camOn; t.enabled=S.camOn;
  $('btncam').classList.toggle('on',!S.camOn);
  $('btncam').textContent=S.camOn?'🎥':'📵';
  toast(S.camOn?'Camera on':'Camera off');
}

function toggleFS(){ const el=$('vgrid'); if(!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.(); }

function applyFilter(f){
  S.filter=f;
  const v=document.querySelector('#vl video'); if(v) v.style.filter=f==='none'?'':f;
  $$('.fc').forEach(b=>b.classList.toggle('on',b.dataset.f===f));
}
$$('.fc').forEach(b=>b.onclick=()=>applyFilter(b.dataset.f));

// ── Game Invite ──────────────────────────────────────────────────────────
function showInviteMenu(tid,tname){
  const old=document.getElementById('inv-choose'); old?.remove();
  const html=\`<div class="pop-ov" id="inv-choose" onclick="if(event.target.id==='inv-choose')event.target.remove()"><div class="pop-box"><div class="pop-icon">🎮</div><div class="pop-title">Invite \${esc(tname)}</div><div class="pop-desc">Choose a game:</div><div class="pop-acts" style="flex-direction:column;gap:8px"><button class="btn btn-p btn-w" onclick="sendInv('\${tid}','ttt');document.getElementById('inv-choose').remove()">⚔️ Tic Tac Toe</button><button class="btn btn-pu btn-w" onclick="sendInv('\${tid}','c4');document.getElementById('inv-choose').remove()">🔴 Connect 4</button><button class="btn btn-s btn-w" onclick="document.getElementById('inv-choose').remove()">Cancel</button></div></div></div>\`;
  document.body.insertAdjacentHTML('beforeend',html);
}

function sendInv(tid,gt){ socket.emit('game-invite',{targetId:tid,gameType:gt}); toast('Game invite sent!','inf'); }

socket.on('game-invite',({fromId,fromName,gameType})=>{
  S.pendingInv={fromId,fromName,gameType};
  const gn=gameType==='c4'?'Connect 4':'Tic Tac Toe';
  $('inv-desc').textContent=fromName+' invited you to play '+gn+'!';
  $('inv-pop').classList.remove('hidden');
});
$('btn-acc').onclick=()=>{
  if(!S.pendingInv)return;
  socket.emit('game-invite-response',{fromId:S.pendingInv.fromId,accepted:true,gameType:S.pendingInv.gameType});
  $('inv-pop').classList.add('hidden'); S.pendingInv=null;
};
$('btn-dec').onclick=()=>{
  if(!S.pendingInv)return;
  socket.emit('game-invite-response',{fromId:S.pendingInv.fromId,accepted:false,gameType:S.pendingInv.gameType});
  $('inv-pop').classList.add('hidden'); S.pendingInv=null; toast('Invite declined.');
};
socket.on('game-invite-declined',({byName})=>toast(byName+' declined your invite.','inf'));

// ── Game Rendering ───────────────────────────────────────────────────────
function applyGame(g){
  S.game=g; if(!g){closeGame();return;}
  const idx=g.players.indexOf(S.myId);
  S.amPlayer=idx!==-1; S.mySym=idx===0?'R':idx===1?'Y':null;
  g.type==='c4'?renderC4(g):renderTTT(g);
  $('btn-cg').classList.remove('hidden');
}

function resetGameArea(){
  $('garea').innerHTML='<div class="gempty"><div class="gempty-i">🎮</div><p>Invite a member to play</p><p style="font-size:.7rem;color:var(--text3);margin-top:3px">Click 🎮 next to a name</p></div>';
  $('btn-cg').classList.add('hidden');
}

function closeGame(){ socket.emit('game-reset'); resetGameArea(); S.game=null; S.amPlayer=false; S.mySym=null; }

function gameStatus(g){
  const myT=g.active&&S.amPlayer&&g.currentTurn===S.myId;
  if(!g.active){
    if(g.winner==='draw') return {t:"It's a draw! 🤝",c:''};
    if(g.winner===S.myId) return {t:'You won! 🏆',c:'win'};
    const wn=S.users.find(u=>u.id===g.winner)?.username||'?';
    return {t:wn+' won!',c:'win'};
  }
  if(myT) return {t:'Your turn! '+(S.mySym==='R'?(g.type==='c4'?'🔴':'✕'):(g.type==='c4'?'🟡':'○')),c:'yt'};
  return {t:'Waiting for opponent…',c:''};
}

function renderTTT(g){
  const p0=S.users.find(u=>u.id===g.players[0])?.username||'?';
  const p1=S.users.find(u=>u.id===g.players[1])?.username||'?';
  const {t,c}=gameStatus(g);
  let cells='';
  for(let i=0;i<9;i++){
    const v=g.board[i];
    cells+=\`<div class="tc\${v?' f '+(v==='R'?'rx':'ry'):''}" data-i="\${i}">\${v==='R'?'✕':v==='Y'?'○':''}</div>\`;
  }
  $('garea').innerHTML=\`<div class="ttt-w"><div class="ttt-s \${c}">\${esc(t)}</div><div class="ttt-grid" id="tttb">\${cells}</div><div style="font-size:.7rem;color:var(--text3);text-align:center;margin-top:5px"><span style="color:var(--cyan)">✕ \${esc(p0)}</span> vs <span style="color:var(--purple)">○ \${esc(p1)}</span></div></div>\`;
  $$('#tttb .tc').forEach(c=>{
    c.onclick=()=>{
      if(!S.game?.active||!S.amPlayer||S.game.currentTurn!==S.myId||S.game.board[+c.dataset.i])return;
      socket.emit('game-move',{index:+c.dataset.i});
    };
  });
}

function renderC4(g){
  const ROWS=6,COLS=7;
  const p0=S.users.find(u=>u.id===g.players[0])?.username||'?';
  const p1=S.users.find(u=>u.id===g.players[1])?.username||'?';
  const {t,c}=gameStatus(g);
  let cols='';
  for(let col=0;col<COLS;col++){
    let cells='';
    for(let row=0;row<ROWS;row++){
      const v=g.board[row*COLS+col];
      cells+=\`<div class="c4-cell\${v?' '+(v==='R'?'rx':'ry'):''}"></div>\`;
    }
    cols+=\`<div class="c4-col" data-col="\${col}">\${cells}</div>\`;
  }
  $('garea').innerHTML=\`<div class="c4-w"><div class="c4-s \${c}">\${esc(t)}</div><div class="c4-board" id="c4b">\${cols}</div><div style="font-size:.7rem;color:var(--text3);text-align:center;margin-top:5px"><span style="color:#ef4444">🔴 \${esc(p0)}</span> vs <span style="color:var(--yellow)">🟡 \${esc(p1)}</span></div></div>\`;
  $$('#c4b .c4-col').forEach(col=>{
    col.onclick=()=>{
      if(!S.game?.active||!S.amPlayer||S.game.currentTurn!==S.myId)return;
      const c=+col.dataset.col;
      for(let r=ROWS-1;r>=0;r--){
        if(!S.game.board[r*COLS+c]){socket.emit('game-move',{index:r*COLS+c});break;}
      }
    };
  });
}

// ── Socket events ────────────────────────────────────────────────────────
socket.on('connect',()=>{S.myId=socket.id;});
socket.on('disconnect',()=>{if($('screen-room').classList.contains('active'))toast('Connection lost…','err');});
socket.on('user-joined',({userId})=>{if(S.callActive&&S.localStream)makeOffer(userId);});
socket.on('system-message',({text,timestamp})=>addSys(text,timestamp));
socket.on('new-message',data=>addMsg(data));
socket.on('user-left',({userId})=>{if(S.peers[userId]){S.peers[userId].close();delete S.peers[userId];removeRemoteVid(userId);}});
socket.on('users-update',users=>{S.users=users;renderMembers(users);});
socket.on('user-typing',({userId,username,isTyping})=>{
  if(isTyping)S.typingUsers[userId]=username; else delete S.typingUsers[userId];
  updateTyping();
});
socket.on('webrtc-offer',async({offer,fromId})=>{
  if(!S.callActive){
    try{
      if(!S.localStream){
        S.localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
        S.callActive=true; addLocalVid(); applyFilter(S.filter);
        $('btn-sc').classList.add('hidden'); $('btn-ec').classList.remove('hidden');
        $('vsec').classList.add('big'); $('rc').classList.add('big');
      }
    }catch(e){return;}
  }
  const pc=makePeer(fromId);
  S.localStream?.getTracks().forEach(t=>pc.addTrack(t,S.localStream));
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const ans=await pc.createAnswer(); await pc.setLocalDescription(ans);
  socket.emit('webrtc-answer',{answer:ans,targetId:fromId});
});
socket.on('webrtc-answer',async({answer,fromId})=>{const pc=S.peers[fromId];if(pc)await pc.setRemoteDescription(new RTCSessionDescription(answer)).catch(()=>{});});
socket.on('webrtc-ice-candidate',async({candidate,fromId})=>{const pc=S.peers[fromId];if(pc)await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{});});
socket.on('game-started',({game,playerNames})=>{
  applyGame(game);
  const gn=game.type==='c4'?'Connect 4':'Tic Tac Toe';
  const myIdx=game.players.indexOf(S.myId);
  if(S.amPlayer)toast(gn+' started! You are '+(myIdx===0?(game.type==='c4'?'🔴 Red':'✕ X'):(game.type==='c4'?'🟡 Yellow':'○ O')),'ok');
  else toast(gn+' started! Spectating…','inf');
});
socket.on('game-state',g=>{if(g)applyGame(g);});
socket.on('game-over',({winnerId,winnerName,isDraw})=>{
  if(S.game){S.game.active=false;S.game.winner=isDraw?'draw':winnerId;applyGame(S.game);}
  if(isDraw)toast("It's a draw! 🤝");
  else if(winnerId===S.myId)toast('You won! 🏆','ok');
  else toast(winnerName+' won the game!');
});
socket.on('game-closed',()=>{
  S.game=null;S.amPlayer=false;S.mySym=null;resetGameArea();
});

document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&$('screen-auth').classList.contains('active')){
    if(!$('tj').classList.contains('hidden'))doJoin(); else doCreate();
  }
});
console.log('%c⬡ AnonChat v2 ready','color:#00d4ff;font-weight:bold');
</script>
</body>
</html>`;
