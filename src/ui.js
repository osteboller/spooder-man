// The score/points overlay is plain DOM (see index.html + style.css), not
// drawn on the canvas — easier to style and animate independently of the
// game loop. Game logic never touches the DOM directly; it goes through here.
import { formatTime } from './scoring.js';

export function createUI(){
  const grabsEl = document.getElementById('grabs');
  const totalEl = document.getElementById('total');
  const pointsEl = document.getElementById('points');
  const timeEl = document.getElementById('time');
  const livesEl = document.getElementById('lives');
  const msgEl = document.getElementById('msg');

  return {
    setTotal(n){ totalEl.textContent = String(n); },
    setGrabs(n){ grabsEl.textContent = String(n); },
    setPoints(n){ pointsEl.textContent = String(n); },
    setLives(n, max){
      const filled = Math.max(0, Math.min(max, n));
      livesEl.textContent = '❤'.repeat(filled) + '🤍'.repeat(max - filled);
    },

    setTime(ms){
      const text = formatTime(ms);
      if(timeEl.textContent !== text) timeEl.textContent = text;
    },

    showMessage(html, { brief = false, win = false, gameover = false, shouldHide = () => true } = {}){
      msgEl.innerHTML = html;
      msgEl.style.display = 'block';
      msgEl.classList.toggle('win', win);
      msgEl.classList.toggle('gameover', gameover);
      if(brief){
        setTimeout(() => { if(shouldHide()) msgEl.style.display = 'none'; }, 450);
      }
    },

    hideMessage(){
      msgEl.style.display = 'none';
      msgEl.classList.remove('win', 'gameover');
    }
  };
}
