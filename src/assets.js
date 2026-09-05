// Central place to register every image the game needs.
// Add new backgrounds/sprites here — nothing else needs to know the file paths.
export const ASSET_MANIFEST = {
  images: {
    playerIdle: 'assets/sprites/player_idle.png',
    playerGrab: 'assets/sprites/player_grab.png',
    playerWindup: 'assets/sprites/player_windup.png',
    playerRoll: 'assets/sprites/player_roll.png',
    playerAttack: 'assets/sprites/player_attack.png',
    playerHurt: 'assets/sprites/player_hurt.png',
    enemy: 'assets/sprites/enemy.png',
    bgNight1: 'assets/backgrounds/bg_night1.png',
    bgNight2: 'assets/backgrounds/bg_night2.png',
    bgDay1: 'assets/backgrounds/bg_day1.png',
  }
};

function loadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${src}`));
    img.src = src;
  });
}

// Loads every image in the manifest and returns { key: HTMLImageElement }.
export async function loadAllImages(manifest = ASSET_MANIFEST){
  const entries = Object.entries(manifest.images);
  const pairs = await Promise.all(
    entries.map(async ([key, src]) => [key, await loadImage(src)])
  );
  return Object.fromEntries(pairs);
}