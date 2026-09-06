// The score/points overlay is plain DOM (see index.html + style.css), not
// drawn on the canvas — easier to style and animate independently of the
// game loop. Game logic never touches the DOM directly; it goes through here.
import { formatTime } from './scoring.js';

export function createUI(){
  const pointsEl = document.getElementById('points');
  const timeEl = document.getElementById('time');
  const livesEl = document.getElementById('lives');
  const msgEl = document.getElementById('msg');

  return {
    setPoints(n){ pointsEl.textContent = String(n); },
    // Renders one icon per life, dimmed past however many you actually have.
    // A 1-up can push n past max, in which case every slot is filled and the
    // row simply grows — there's no "overflow" concept, only more icons.
    setLives(n, max){
      const total = Math.max(n, max);
      livesEl.innerHTML = '';
      for(let i = 0; i < total; i++){
        const img = document.createElement('img');
        img.src = 'assets/sprites/lives_24x24.png';
        img.alt = '';
        img.className = i < n ? 'life-icon' : 'life-icon life-icon-empty';
        livesEl.appendChild(img);
      }
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
