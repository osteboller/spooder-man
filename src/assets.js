// Central place to register every image the game needs.
// Add new backgrounds/sprites here — nothing else needs to know the file paths.
export const ASSET_MANIFEST = {
  images: {
    playerIdle: 'assets/sprites/player_idle.png',
    playerGrab: 'assets/sprites/player_grab.png',
    playerWindup: 'assets/sprites/player_windup.png',
    playerRoll: 'assets/sprites/player_roll.png',
    playerAttack: 'assets/sprites/player_atk.png',
    playerAttackUp: 'assets/sprites/player_atk_up.png',
    playerAttackDown: 'assets/sprites/player_atk_down.png',
    playerHurt: 'assets/sprites/player_hurt.png',
    playerSwing1: 'assets/sprites/player_swing1.png',
    playerSwing2: 'assets/sprites/player_swing2.png',
    playerSwingTurn: 'assets/sprites/player_swing_turn.png',
    playerSwingStop: 'assets/sprites/player_swing_stop.png',
    enemy: 'assets/sprites/enemy.png',
    coin: 'assets/sprites/coin_16x16.png',
    // City theme 'a' (see CITY_THEMES in city.js): one landmark that opens
    // every street, a pool of buildings stitched after it, one sidewalk tile.
    bldgBugle: 'assets/buildings/b_daily_bugle.png',
    bldgA1: 'assets/buildings/building_a1.png',
    bldgA2: 'assets/buildings/building_a2.png',
    bldgA3: 'assets/buildings/building_a3.png',
    bldgA4: 'assets/buildings/building_a4.png',
    bldgA5: 'assets/buildings/building_a5.png',
    bldgA6: 'assets/buildings/building_a6.png',
    sidewalkA: 'assets/buildings/sidewalk_a.png',
    // Theme 'b' — red brick, grey stone, gargoyles. No landmark.
    bldgB1: 'assets/buildings/building_b1.png',
    bldgB2: 'assets/buildings/building_b2.png',
    bldgB3: 'assets/buildings/building_b3.png',
    bldgB4: 'assets/buildings/building_b4.png',
    sidewalkB: 'assets/buildings/sidewalk_b.png',
    // Theme 'c' — olive brick, grey trim, fire escapes. No landmark.
    bldgC1: 'assets/buildings/building_c1.png',
    bldgC2: 'assets/buildings/building_c2.png',
    bldgC3: 'assets/buildings/building_c3.png',
    bldgC4: 'assets/buildings/building_c4.png',
    bldgC5: 'assets/buildings/building_c5.png',
    sidewalkC: 'assets/buildings/sidewalk_c.png',
    bgCity: 'assets/backgrounds/new background test 512x600.png',
    bgTest2: 'assets/backgrounds/new background test 2 512x256.png',
    bgGrassy: 'assets/backgrounds/new background grassy 512x256.png', // parked — see BACKGROUNDS in background.js
    bgNight1: 'assets/backgrounds/bg_night1.png',
    bgNight2: 'assets/backgrounds/bg_night2.png',
    bgDay1: 'assets/backgrounds/bg_day1.png',
    bgEvening1: 'assets/backgrounds/bg_evening1.png',
    titleBg: 'assets/startscreens/Titlescreen_bg.png',
    titleLogo: 'assets/startscreens/Titlescreen_title.png',
    titlePlayer: 'assets/startscreens/Titlescreen_player.png',
    creditsNiba: 'assets/startscreens/niba_and.png',
    creditsOsteboller: 'assets/startscreens/osteboller_presents.png',
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
// onProgress(loaded, total), if given, fires after each image resolves — for
// a loading bar on the first, slowest load (mobile browsers especially).
export async function loadAllImages(manifest = ASSET_MANIFEST, onProgress){
  const entries = Object.entries(manifest.images);
  let loaded = 0;
  const pairs = await Promise.all(
    entries.map(async ([key, src]) => {
      const img = await loadImage(src);
      loaded++;
      if(onProgress) onProgress(loaded, entries.length);
      return [key, img];
    })
  );
  return Object.fromEntries(pairs);
}