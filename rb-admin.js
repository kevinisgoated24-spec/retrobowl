/* Retro Bowl / Retro Bowl College admin panel (one file, works in both)
   Open:  Ctrl + Alt + Q, then the passcode.
   Lets you edit your career save (team money, facilities, every player's stats),
   drafts James Stegall (with a draft-day reveal), gives him 10x super speed and sure
   hands in matches, and makes promo codes that work on every computer.
   Players redeem codes with the PROMO CODE button on Retro Bowl's Options screen (College
   has a PROMO tab on the left edge instead), Ctrl + 1, or Ctrl + Alt + P.
   Built-in codes (each once per save, applied straight away, then the game reloads):
     DISCORD.GG/LUNACY  drafts James Stegall (all stats maxed) + 10,000 coach credits
     JAMES!             50,000 coach credits
   The real James Stegall is tagged with a hidden marker in his save data, so his
   powers stay with him. Renaming another player to James Stegall does nothing.

   Safety
   - The passcode is never stored as text: only a slow, salted hash is kept here.
   - 5 wrong tries locks the passcode box for 1 minute, then 2, 4, 8 ... up to 60.
   - The panel locks itself again after 15 minutes, or when you press Lock.
   - Before every save, the previous save is kept as a backup you can restore.
   Note: this runs in the browser, so someone who can edit this file could still
   get around it. It stops people who just find the shortcut. */
(() => {
  "use strict";

  /* ======================= settings ======================= */
  const SALT = "rb-admin.v2.7f3c91";
  const PASS_PBKDF2 = "21517c212c66b4bbf82b6974a54a4383d5060d6032608e18fa4ce9d83e9e7a35"; // 150,000 rounds of SHA-256
  const PASS_FALLBACK = "2ghdv55k7p6";   // used only where the browser blocks secure hashing
  const MAX_TRIES = 5, AUTO_LOCK_MS = 15 * 60 * 1000;

  /* ======================= which game is this? =======================
     Retro Bowl and Retro Bowl College run on the same engine, but the original
     has its internal names scrambled while College keeps readable ones. */
  const COLLEGE = typeof window.gml_Script_s_check_ball_collision === "function" || /retro-bowl-college/i.test(location.pathname);
  const N = COLLEGE ? {
    game: "Retro Bowl College", savePrefix: "RetroBowlCollege.", ns: "rbcAdmin.",
    speed: "gml_Script_s_get_attribute", catchFn: "gml_Script_s_check_ball_collision", drop: "gml_Script_s_check_tipped", ai: "gml_Script_s_aim_AI_offense",
    inst: "yyInst", get: "ds_map_find_value", ball: "gmlmaster_ball", ctrl: 0x2B, mark: 0x5C, assetRef: true,
    offense: "gmloffense", pmap: "gmlpmap", jdir: "gmljdir", jforce: "gmljforce", accel: "gmlmy_accel", hs: "hspeed", vs: "vspeed",
    state: "gmlstate", holder: "gmlholder", height: "gmlheight", zvel: "gmlzvel", running: "gmlrunning_play", dropped: "gmldrop_happened", bx: "gmlbounce_x", by: "gmlbounce_y", vel: "gmlvelocity", dir: "gmldirec",
    cam: () => { const c = window.g_pBuiltIn.view_camera[0]; return [window.camera_get_view_x(c), window.camera_get_view_y(c), window.camera_get_view_width(c), window.camera_get_view_height(c)]; }
  } : {
    game: "Retro Bowl", savePrefix: "RetroBowl.", ns: "rbAdmin.",
    speed: "_Iv1", catchFn: "_tv1", drop: "_Gv1", ai: "_tA1", throwPow: "_nt1", drawSpr: "_9s", commDef: "_GE1",
    kickAim: "_8s1", kickPow: "_1u1", kickMeter: "_Rt1", kickHolder: "_J71", kickX: "_gs1", injure: "_iI1", pdir: "_R71", byId: "_Jm",
    inst: "_Jm", get: "_5n", ball: "_Rw", ctrl: 99, mark: 106, assetRef: false,
    offense: "_K71", pmap: "_4q", jdir: "_I71", jforce: "_G71", accel: "_Ex1", hs: "_Rb", vs: "_Sb",
    state: "_qA", holder: "_J71", height: "_au1", zvel: "_ot1", running: "_Ss1", dropped: "_Kv1", bx: "_j81", by: "_k81", vel: "_mt1", dir: "_8t1",
    cam: () => { const c = window._Vo._G52[0]; return [window._T52(c), window._V52(c), window._I52(c), window._K52(c)]; }
  };
  const LOCK_KEY = "rbAdmin.lk", BOOST_KEY = N.ns + "boost", CATCH_KEY = N.ns + "autocatch", BACKUP_KEY = N.ns + "backup.";

  const STAR = { fname: "James", lname: "Stegall" };
  /* The real James Stegall carries this hidden key in his player data. His powers
     follow the key, not his name, so renaming someone else to "James Stegall"
     gives them nothing (and renaming him keeps his powers). */
  const STAR_KEY = "lunacy_star", STAR_TOKEN = "jstegall-v1";
  /* Jimmy Sahur: a quarterback with the longest arm in the game. Like Stegall he is
     tagged with the hidden key (his own value), so renaming someone else does nothing. */
  const JIMMY = { fname: "Jimmy", lname: "Sahur" }, JIMMY_TOKEN = "jsahur-v1";
  /* Black, long dreads (the game's face sheet spr_dark_007, picture 6), with red eyes
     drawn over his face whenever the game shows it. */
  const JIMMY_LOOK = { skin: 0, face_x: 6, face_y: 7 };
  const JIMMY_FACE_SPR = 190;        // skin 0 + face_y 7 = sprite 190 (spr_dark_007)
  const SQUARE_SPR = 161;            // spr_square: a plain 16x16 white square, tinted to paint single pixels
  const JIMMY_EYES = [[12, 10], [12, 11], [14, 11], [20, 10], [20, 11], [18, 11]];   // the whites of his eyes in that picture
  const JIMMY_EYE_COLOR = (30 << 16) | (30 << 8) | 230;   // red (the game's colours are blue-green-red)
  const JIMMY_ARM = 15;   // his strength for everything else (a normal player tops out at 10)
  /* His throws reach 100 yards. How it works in the game: a pass leaves at
     (drag length, max 100) x (QB throw power) pixels per step, goes up at 35% of
     that, slows 1.4% a step, falls 0.08 a step, and a yard is 20 pixels.
     A normal QB's power tops out at 0.12 (about 33 yards on a full drag).
     At 0.30 a full drag carries about 103 yards (a half drag about 45), so a
     full-power pass covers the whole 100-yard field. */
  const JIMMY_POWER = 0.30;
  /* Receivers only chase a pass while it's within 260 + 40 x the QB's strength
     pixels; past that they coast. For Jimmy they read 50, so they keep chasing
     out to 2260 pixels (113 yards). */
  const JIMMY_RANGE_ARM = 50;

  /* ===== more special players (Retro Bowl only), each with their own code =====
     look: the game's face picture (skin + face_x/face_y); patch: pixels lunacy paints on
     top of that picture whenever the game draws it (x,y,colour). */
  const SPECIALS = {
    boswell: { token: "cboswell-v1", fname: "Christopher", lname: "Boswell", pos: 11, age: 27,
      look: { skin: 2, face_x: 4, face_y: 2 }, spr: 181,            // white, beard...
      patch: "13,4,d9a066;14,4,d9a066;15,4,d9a066;16,4,d9a066;17,4,d9a066;18,4,d9a066;19,4,d9a066;20,4,d9a066;12,5,d9a066;13,5,eec39a;14,5,eec39a;15,5,eec39a;16,5,eec39a;17,5,eec39a;18,5,eec39a;19,5,eec39a;20,5,eec39a;21,5,d9a066;11,6,d9a066;12,6,eec39a;13,6,eec39a;14,6,eec39a;15,6,eec39a;16,6,eec39a;17,6,eec39a;18,6,eec39a;19,6,eec39a;20,6,eec39a;21,6,d9a066;11,7,d9a066;12,7,eec39a;15,7,eec39a;16,7,eec39a;17,7,eec39a;18,7,eec39a;20,7,eec39a;21,7,d9a066;11,8,d9a066;16,8,eec39a;17,8,eec39a;18,8,eec39a;21,8,d9a066;14,11,3f8cff;18,11,3f8cff",   // ...made bald, with blue eyes
      kicker: true },
    jerry: { token: "jstegall2-v1", fname: "Jerry", lname: "Stegall", pos: 2, age: 22,
      look: { skin: 0, face_x: 3, face_y: 3 }, spr: 186, rb: true },   // Black, no hair anywhere
    bryson: { token: "bwilliams-v1", fname: "Bryson", lname: "Williams", pos: 2, age: 21,
      look: { skin: 0, face_x: 2, face_y: 1 }, spr: 184,
      patch: "12,2,7ef9ff;15,2,7ef9ff;17,2,7ef9ff;20,2,7ef9ff;21,2,7ef9ff;10,3,7ef9ff;13,3,7ef9ff;14,3,7ef9ff;16,3,7ef9ff;18,3,7ef9ff;19,3,7ef9ff;23,3,7ef9ff;24,3,7ef9ff;9,4,7ef9ff;11,4,7ef9ff;12,4,7ef9ff;15,4,7ef9ff;18,4,7ef9ff;22,4,7ef9ff;10,5,7ef9ff;11,5,7ef9ff;14,5,7ef9ff;19,5,7ef9ff;21,5,7ef9ff;23,5,7ef9ff;9,6,7ef9ff;11,6,7ef9ff;13,6,7ef9ff;19,6,7ef9ff;21,6,7ef9ff;24,6,7ef9ff;9,7,7ef9ff;13,7,7ef9ff;20,7,7ef9ff;22,7,7ef9ff;9,8,7ef9ff;13,8,7ef9ff;20,8,7ef9ff;22,8,7ef9ff;9,9,7ef9ff;13,10,00e5ff;14,10,00e5ff;18,10,00e5ff;19,10,00e5ff;10,11,e8ffff;22,11,e8ffff;10,12,e8ffff;22,12,e8ffff",   // custom: icy blue twists, glowing eyes, ice earrings
      rb: true },
    lebron: { token: "lbj-v1", fname: "LeBron", lname: "James", pos: 1, age: 24,
      look: { skin: 0, face_x: 3, face_y: 0 }, spr: 183, arm: true },  // beard + headband
    chad: { token: "chadpowers-v1", fname: "Chad", lname: "Powers", pos: 1, age: 25,
      look: { skin: 2, face_x: 4, face_y: 1 }, spr: 180,             // long blond hair...
      patch: "14,15,908646;15,15,908646;16,15,908646;17,15,908646;18,15,908646;14,16,908646;18,16,908646" },   // ...plus a mustache
  };
  const SPEC_BY_TOKEN = {};
  for (const k in SPECIALS) { const sp = SPECIALS[k]; sp.key = k; SPEC_BY_TOKEN[sp.token] = sp;
    sp.pixels = (sp.patch || "").split(";").filter(Boolean).map(t => { const [x, y, c] = t.split(","); const n = parseInt(c, 16); return [+x, +y, ((n & 255) << 16) | (n & 0xff00) | (n >> 16)]; }); }
  const RB_SPEED = 3;          // the two running backs move 3x as far each step during a live play
  const RB_STRENGTH = 15;      // and break tackles like nobody else (a normal player tops out at 10)
  /* Boswell's kicks: aimed dead centre between the posts every time, with enough power
     to make it from anywhere on the field. A kick leaves at (50 + meter) x power px/step,
     rises at 40% of that, slows 0.05% a step and falls 0.03 a step; at 0.115 a full meter
     carries about 140 yards, so even a kick from your own goal line clears the bar. */
  const BOS_POWER = 0.115;
  const STAR_LOOK = { skin: 2, face_x: 1, face_y: 0 };   // white, clean-shaven, black hair with bangs
  const POS = { 1: "QB", 2: "RB", 3: "TE", 4: "WR", 5: "OL", 6: "DL", 7: "LB", 8: "DB", 9: "DB", 10: "P", 11: "K" };
  const POS_NAME = { 1: "Quarterback", 2: "Running back", 3: "Tight end", 4: "Wide receiver", 5: "Offensive line", 6: "Defensive line", 7: "Linebacker", 8: "Defensive back", 9: "Defensive back", 10: "Punter", 11: "Kicker" };
  const STATS = [["skill", "Skill", "Throwing, catching, blocking and tackling"], ["speed", "Speed", "How fast he runs"], ["strength", "Strength", "Breaking and making tackles"], ["stamina", "Stamina", "How long he lasts before tiring"]];
  const FACE_ROWS = { 0: 8, 1: 1, 2: 3 };   // face_y choices per skin tone

  /* Team values shown with clear names. Anything else goes under "More values". */
  const TEAM = [
    ["Money and staff", [
      ["coach_credit", "Coach credits", "Spent on upgrades, staff and boosts", 0, 9999],
      ["salary_cap", "Salary cap ($M)", "Most you can spend on player salaries", 0, 999],
      ["boost_salary_cap", "Extra salary cap ($M)", "Bonus on top of the salary cap", 0, 999],
      ["coach_rating", "Coach rating", "Your coaching stars", 0, 5]]],
    ["Recruiting (College)", [
      ["recruitment_credits", "Recruitment credits", "Spent signing new recruits", 0, 999],
      ["recruitment_credits_cap", "Recruitment credit cap", "Most recruitment credits you can hold", 0, 999],
      ["boost_recruitment_credits_cap", "Extra recruitment cap", "Bonus on top of the cap", 0, 999]]],
    ["Fans and owner", [
      ["fans", "Fan support", "0 to 100. Low fans can get you fired", 0, 100],
      ["relationship_boss", "Owner relationship", "0 to 100. How happy the owner is with you", 0, 100]]],
    ["Facilities", [
      ["facility_stadium", "Stadium", "Level 1 to 5. Better crowd and more fans", 1, 5],
      ["facility_training", "Training", "Level 1 to 5. Players improve faster", 1, 5],
      ["facility_rehab", "Rehab", "Level 1 to 5. Injuries heal faster", 1, 5]]],
    ["Draft picks", [
      ["draft_picks_0", "1st round picks", "How many 1st round picks you hold", 0, 9],
      ["draft_picks_1", "2nd round picks", "How many 2nd round picks you hold", 0, 9],
      ["draft_picks_2", "3rd round picks", "How many 3rd round picks you hold", 0, 9]]],
  ];
  const LIST_KEYS = /^(roster|draftlist|freeagentlist|tradelist|hirelist|storelist|stafflist|hoflist|rbhistorylist|shoppinglist|list_teams_rejected|teamlist|achievements|records|history|schedule|fixturelist|playoffs|news_dyn)(_|$)/;

  /* ======================= small helpers ======================= */
  const $ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const cyrb = s => { let h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); };
  const isStarMap = m => !!m && m[STAR_KEY] === STAR_TOKEN;
  const namedStar = m => !!m && m.lname === STAR.lname && m.fname === STAR.fname;

  /* ======================= promo codes: shared core =======================
     Codes live in promo-codes.json next to this file, so every computer that loads
     the game reads the same list. The file never holds the codes as text: each code
     is stored as a slow SHA-256 hash (to check what players type) plus a copy that
     only this admin passcode can unscramble (so you can see your codes later). */
  const sha256 = (() => {
    const P = [], K = [], H0 = [];
    for (let n = 2; P.length < 64; n++) if (P.every(p => n % p)) P.push(n);
    const frac = x => ((x - Math.floor(x)) * 4294967296) | 0;
    P.forEach((p, i) => { K[i] = frac(Math.cbrt(p)); if (i < 8) H0[i] = frac(Math.sqrt(p)); });
    return str => {
      const s = unescape(encodeURIComponent(str)), l = s.length, words = [];
      for (let i = 0; i < l; i++) words[i >> 2] |= s.charCodeAt(i) << (24 - (i % 4) * 8);
      words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
      const n = (((l + 8) >> 6) + 1) * 16; words[n - 1] = l * 8;
      for (let i = 0; i < n; i++) words[i] |= 0;
      let H = H0.slice(); const w = new Array(64);
      for (let j = 0; j < n; j += 16) {
        for (let i = 0; i < 64; i++) {
          if (i < 16) w[i] = words[j + i];
          else { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + ((a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ (a >>> 3)) + w[i - 7] + ((b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ (b >>> 10))) | 0; }
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
          const t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
          const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
          h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H = [H[0] + a | 0, H[1] + b | 0, H[2] + c | 0, H[3] + d | 0, H[4] + e | 0, H[5] + f | 0, H[6] + g | 0, H[7] + h | 0];
      }
      return H.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
    };
  })();
  const PROMO_FILE = "promo-codes.json", PROMO_DRAFT = N.ns + "promoDraft", REDEEMED = N.ns + "redeemed", PROMO_LK = N.ns + "promoLk";
  const normCode = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const codeHash = c => { let h = "rbpromo|" + N.ns + "|" + normCode(c); for (let i = 0; i < 2000; i++) h = sha256(h); return h; };
  const adminKeyFrom = pw => { let h = "rbpromo-key|" + pw; for (let i = 0; i < 3000; i++) h = sha256(h); return h; };
  const keystream = (key, salt, i) => parseInt(sha256(key + "|" + salt + "|" + Math.floor(i / 32)).substr((i % 32) * 2, 2), 16);
  const hideName = (code, key, salt) => [...code].map((ch, i) => (ch.charCodeAt(0) ^ keystream(key, salt, i)).toString(16).padStart(2, "0")).join("");
  const showName = (e, key) => { try { if (!key || !e.c) return null; let out = ""; for (let i = 0; i < e.c.length / 2; i++) out += String.fromCharCode(parseInt(e.c.substr(i * 2, 2), 16) ^ keystream(key, e.s, i)); return codeHash(out) === e.h ? out : null; } catch (x) { return null; } };
  /* codes built into this file (stored as hashes, like promo-codes.json) */
  const BUILTIN = [
    { h: COLLEGE ? "13dc8a9bfce28f54d883b7ae4064d9e544666f537a17f91ea31bc4a0336d6ae6" : "dfa96483a9a221865111a002660390b0495272a2c819da5a9a7e3a994362a53b",
      msg: "Thanks for joining discord.gg/lunacy!", r: { stegall: true, coach_credit: 10000 }, instant: true },
    /* JAMES! (the "!" is optional when typing it) */
    { h: COLLEGE ? "f879ae01d47e59685d1102c59963f0c379cbacd21de7c1fc7e0523d4856c2b81" : "3a9337fe1e43f5f49c704504711cf627ae20a36da1cfe30acc1bbea6fbb5f444",
      msg: "JAMES!", r: { coach_credit: 50000 }, instant: true },
    /* THANKSFOR7200! (the "!" is optional): Jimmy Sahur joins your team, +72,000 credits. Retro Bowl only. */
    ...(COLLEGE ? [] : [{ h: "f36da8b5a79f1583783ecc7ff82ef2f5836faf60a6d6c3066880ad1686c7a1f6",
      msg: "Thanks for 7200!", r: { jimmy: true, coach_credit: 72000 }, instant: true }]),
    /* CHRISTYLOL333: Christopher Boswell, K. Retro Bowl only. */
    ...(COLLEGE ? [] : [{ h: "8bc636d9ed6615da479aeb322c8107b3882615042671e1797bedaae71e85ced0", msg: "Christopher Boswell signed!", r: { special: "boswell" }, instant: true }]),
    /* JerryLOLXD1923: Jerry Stegall, RB */
    ...(COLLEGE ? [] : [{ h: "c36a608e2deea0b46fd57703b46f1dce3176517744431f83ad101083895ee858", msg: "Jerry Stegall signed!", r: { special: "jerry" }, instant: true }]),
    /* BryWilqwerty: Bryson Williams, RB */
    ...(COLLEGE ? [] : [{ h: "4d90f215ded0ca3338ea4164dde0b6452270232fc8889f55850b194491750972", msg: "Bryson Williams signed!", r: { special: "bryson" }, instant: true }]),
    /* LebronnyBaby333: LeBron James, QB (Jimmy Sahur's arm) */
    ...(COLLEGE ? [] : [{ h: "247ea5b3f4cae6d7bb4a1ef0a9b4ce572edf12848adbf047a17de465f7d2f9d4", msg: "LeBron James signed!", r: { special: "lebron" }, instant: true }]),
    /* CHADPOWERS: Chad Powers, QB, +100,000 credits */
    ...(COLLEGE ? [] : [{ h: "bbefac6be7c1a50002c57d4132d94d1e668b59c27939abfc5e9043e87e724201", msg: "Chad Powers signed!", r: { special: "chad", coach_credit: 100000 }, instant: true }]),
    /* BROSDEAD: Max out entire defense (DL, LB, DB) to 5 stars */
    ...(COLLEGE ? [] : [{ h: "5336e398366ba9abfe710686ec22d9da5c41abeff49b8c5a8c01be97852df7c5", msg: "Bros are dead fr, defense going CRAZY!", r: { defmax: true }, instant: true }]),
    /* SUPERBOWLWINNER: entire team 5 stars, god-speed, no drops, unbreakable */
    ...(COLLEGE ? [] : [{ h: "189ed7de7ee2f1a2f44efd27e5c0eb34613e729225299930e55caa481c767fb7", msg: "Super Bowl winner energy activated. Good luck stopping this team.", r: { godmode: true }, instant: true }]),
  ];
  async function fetchPromo() {
    try { const r = await fetch(PROMO_FILE + "?t=" + Date.now(), { cache: "no-store" }); if (!r.ok) return null; const j = await r.json(); return j && Array.isArray(j.codes) ? j : null; } catch (e) { return null; }
  }
  /* What a code can give. Each one only applies if the save has that value. */
  const REWARDS = [
    ["coach_credit", "Coach credits", "add", 0, 9999],
    ...(COLLEGE ? [["recruitment_credits", "Recruitment credits", "add", 0, 999]] : []),
    ["fans", "Fan support", "pct", -100, 100],
    ["relationship_boss", "Owner relationship", "pct", -100, 100],
    ["boost_salary_cap", "Extra salary cap ($M)", "add", 0, 999],
    ["skill_points", "Skill points for every player", "players", 0, 99]];
  const REWARD_FLAGS = [["heal", "Heal everyone"], ["morale", "Max everyone's morale"], ["maxstats", "Max everyone's stats"], ["stegall", "Draft James Stegall (with the draft-day reveal)"], ...(COLLEGE ? [] : [["jimmy", "Draft Jimmy Sahur (QB, longest arm)"]])];
  function describeRewards(r) {
    const out = [];
    for (const [k, label, kind] of REWARDS) { const v = Math.round(num(r[k])); if (v) out.push(kind === "players" ? `+${v} skill points for every player` : `${v > 0 ? "+" : ""}${v}${kind === "pct" ? "%" : ""} ${label.replace(" ($M)", "")}${k === "boost_salary_cap" ? "M" : ""}`); }
    for (const [k, label] of REWARD_FLAGS) if (r[k]) out.push(k === "stegall" ? "James Stegall joins your team (all stats maxed)" : label);
    for (const c of r.custom || []) if (c.k && num(c.v)) out.push(`${num(c.v) > 0 ? "+" : ""}${num(c.v)} ${c.k.replace(/_/g, " ")}`);
    return out;
  }

  async function checkPass(pw) {
    try {
      if (window.crypto && crypto.subtle && window.isSecureContext) {
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(SALT), iterations: 150000, hash: "SHA-256" }, key, 256);
        return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("") === PASS_PBKDF2;
      }
    } catch (e) {}
    let f = pw; for (let i = 0; i < 20000; i++) f = cyrb(SALT + f);
    return f === PASS_FALLBACK;
  }
  const lockState = () => { try { return JSON.parse($ls.get(LOCK_KEY)) || { fails: 0, until: 0, round: 0 }; } catch (e) { return { fails: 0, until: 0, round: 0 }; } };
  const setLock = s => $ls.set(LOCK_KEY, JSON.stringify(s));

  /* ======================= in-match hooks for James Stegall ======================= */
  const getBoost = () => { const v = parseFloat($ls.get(BOOST_KEY)); return isNaN(v) ? 90 : v; };
  /* top-speed multiplier: 10 = he covers ground 10 times faster than he normally would */
  const SPEEDX_KEY = N.ns + "speedx";
  const getSpeedX = () => { const v = parseFloat($ls.get(SPEEDX_KEY)); return isNaN(v) ? 10 : clamp(v, 1, 15); };
  const autoCatchOn = () => $ls.get(CATCH_KEY) !== "0";
  const isStar = map => { try { return window[N.get](map, STAR_KEY) === STAR_TOKEN; } catch (e) { return false; } };
  const isJimmyMap = m => !!m && m[STAR_KEY] === JIMMY_TOKEN;
  const isJimmy = map => { try { return window[N.get](map, STAR_KEY) === JIMMY_TOKEN; } catch (e) { return false; } };
  const specOf = map => { if (COLLEGE || !map) return null; try { return SPEC_BY_TOKEN[window[N.get](map, STAR_KEY)] || null; } catch (e) { return null; } };
  const isArm = map => isJimmy(map) || ((specOf(map) || {}).arm === true);
  const specMapOf = m => !!m && SPEC_BY_TOKEN[m[STAR_KEY]] || null;
  const G = () => window.global || {};
  const inst = (from, obj) => { try { return window[N.inst](from, from, N.assetRef ? window.YYASSET_REF(obj) : obj); } catch (e) { return null; } };
  let chasing = false, chase = null;
  const REACT_STEPS = 9;        // ~0.15s to read the ball before breaking off the route
  const CATCH_H = 26;           // the game lets you catch below about this height
  const pdir = (dx, dy) => { let d = Math.atan2(-dy, dx) * 180 / Math.PI; return d < 0 ? d + 360 : d; };

  function passInAir(p) {
    const ball = (() => { try { return window[N.inst](p, p, G()[N.ball]); } catch (e) { return null; } })(), ctrl = inst(p, N.ctrl);
    if (!ball || !ctrl) return null;
    // 3 = ball in the air with nobody holding it; skip running plays and fumbles
    if (ball[N.state] !== 3 || ball[N.holder] !== -4 || ctrl[N.state] !== 2 || ctrl[N.running] || ctrl[N.dropped]) return null;
    return ball;
  }
  // steps until the ball falls to height h (h + v*t - g*t*t/2 = target)
  const stepsTo = (h, v, g, target) => { if (h <= target) return 0; return (v + Math.sqrt(Math.max(0, v * v + 2 * g * (h - target)))) / g; };

  function flight(ball) {
    let v = num(ball[N.vel]), dir = num(ball[N.dir]), h = num(ball[N.height]), zv = num(ball[N.zvel]);
    if (!(v > 0) || ball[N.vel] === undefined || ball[N.dir] === undefined) return null;
    const cx = Math.cos(dir * Math.PI / 180), cy = Math.sin(dir * Math.PI / 180);
    let x = ball.x, y = ball.y, meet = null;
    for (let t = 1; t < 900; t++) {
      v *= 0.986; zv -= 0.08; x += cx * v; y += cy * v; h += zv;
      if (!meet && zv < 0 && h <= CATCH_H) meet = { tMeet: t, x, y };
      if (h <= 1) { if (!meet) meet = { tMeet: t, x, y }; meet.tLand = t; return meet; }
    }
    return null;
  }
  // Works out where the ball will come down and how many steps that takes
  function readBall(p) {
    const ball = passInAir(p);
    if (!ball) { chase = null; chasing = false; return null; }
    const mark = inst(p, N.mark);                       // the game's landing-spot marker
    if (!mark || mark[N.bx] === undefined) { chase = null; chasing = false; return null; }
    const tx0 = num(mark[N.bx]), ty0 = num(mark[N.by]);
    if (!chase || chase.id !== ball.id || chase.tx0 !== tx0 || chase.ty0 !== ty0) chase = { id: ball.id, tx0, ty0, steps: 0, zv: null, g: 0.03, react: REACT_STEPS };
    const h = num(ball[N.height]), zv = num(ball[N.zvel]);
    if (chase.zv !== null) { const dg = chase.zv - zv; if (dg > 0.001 && dg < 1) chase.g = chase.g * 0.7 + dg * 0.3; }
    chase.zv = zv;
    /* Play the ball's flight forward with the game's own rules (it slows 1.4% a step
       and falls 0.08 a step), so the spot is right for every throw, Jimmy's 100-yard
       bombs included. The meeting point is where it drops through catch height. */
    const sim = flight(ball);
    if (sim) {
      if (chase.steps === 0) chase.react = Math.min(REACT_STEPS, Math.floor(sim.tLand * 0.15));
      chase.T = sim.tMeet; chase.tx = sim.x; chase.ty = clamp(sim.y, 140, 460);
      chasing = true;
      return chase;
    }
    const tLand = Math.max(stepsTo(h, zv, chase.g, 0), 1);
    // meet it a few steps before it would hit the turf (or as it drops through catch height)
    const tMeet = Math.max(0, Math.min(tLand - 4, Math.max(stepsTo(h, zv, chase.g, CATCH_H), tLand * 0.6)));
    if (chase.steps === 0) chase.react = Math.min(REACT_STEPS, Math.floor(tLand * 0.15));  // quick throws: quick reactions
    const f = clamp(tMeet / tLand, 0, 1);
    chase.T = tMeet;
    chase.tx = ball.x + (tx0 - ball.x) * f;
    chase.ty = clamp(ball.y + (ty0 - ball.y) * f, 140, 460);
    chasing = true;
    return chase;
  }
  const topSpeed = p => 15.6 * Math.max(0.05, num(p[N.accel]) || 0.3);   // where 0.94 friction balances full force

  // Runs him to the spot with the game's own joystick physics, so he speeds up,
  // turns and slows down like a real player and arrives as the ball comes down.
  function runToBall(p) {
    const c = readBall(p);
    if (!c) return;
    if (++c.steps < c.react) return;                // still on his route for a moment
    const dx = c.tx - p.x, dy = c.ty - p.y, d = Math.hypot(dx, dy);
    if (d < 4) { p[N.jforce] = 0; p[N.hs] = 0; p[N.vs] = 0; return; }   // under it: stand and wait for the ball
    // sprint flat out straight at the spot (his super speed carries him; he stops on it)
    p[N.jdir] = pdir(dx, dy);
    p[N.jforce] = 1;
  }

  // If even flat out he'd be late, give him the extra burst he needs (he is the
  // fastest man in the league), and let him stretch out for it at the very end.
  function burst(p) {
    if (!chase || chase.steps < chase.react) return;
    const dx = chase.tx - p.x, dy = chase.ty - p.y, d = Math.hypot(dx, dy);
    if (d < 10) return;
    const need = d / Math.max(chase.T - 1, 1), have = Math.max(topSpeed(p), Math.hypot(num(p[N.hs]), num(p[N.vs])));
    let extra = need > have * 0.9 ? Math.min(need - have * 0.9, 9) : 0;
    if (chase.T <= 5) extra = Math.max(extra, Math.min(3.5, d - 8));
    if (extra > 0) { const k = Math.min(extra, d - 8) / d; p.x += dx * k; p.y += dy * k; }
  }


  /* ======================= James Stegall's super speed ======================= */
  let starRef = null;   // Stegall's player object, refreshed by the catch hook
  let jimmyRef = null;  // Jimmy Sahur's player object, found when the game reads his strength
  let jimmyFace = 0;    // set when the game reads Jimmy's face, so the next sprite drawn gets red eyes
  let specFace = null;  // same for the other special players' face paint
  const armRefs = new Set(), rbRefs = new Set(); let bosRef = null, kickRef = null;
  const rbLast = new Map();
  (function speedLoop() {   // the game stops calling the catch hook for the ball carrier, so watch on our own
    try { if (starRef) speedUp(starRef); } catch (e) {}
    try { if (window.__rbGodMode && window.__rbGodRefs) window.__rbGodRefs.forEach(r => { try { speedUp(r); } catch(e){} }); } catch(e) {}
    try {   // keep Jimmy's (and LeBron's) throw power above the game's cap every frame, so it's set before he throws
      if (N.throwPow && jimmyRef && isJimmy(jimmyRef[N.pmap]) && jimmyRef[N.throwPow] !== JIMMY_POWER) jimmyRef[N.throwPow] = JIMMY_POWER;
      armRefs.forEach(r => { if (isArm(r[N.pmap])) { if (r[N.throwPow] !== JIMMY_POWER) r[N.throwPow] = JIMMY_POWER; } else armRefs.delete(r); });
    } catch (e) {}
    try {   // Boswell: full kick power, and the kick meter held at the top while he lines up
      if (bosRef && specOf(bosRef[N.pmap]) === SPECIALS.boswell) bosRef[N.kickPow] = BOS_POWER;
      if (kickRef && num(kickRef[N.kickMeter]) < 55 && num(kickRef[N.kickMeter]) >= 0) kickRef[N.kickMeter] = 55;
    } catch (e) {}
    try { rbRefs.forEach(rbBoost); } catch (e) {}
    requestAnimationFrame(speedLoop);
  })();
  /* Super speed: whenever the game moves him a step during a live play, move him
     (multiplier - 1) more steps the same way. Works with or without the ball.
     Only runs once per game step, so fast (120 Hz) screens don't double it. */
  let lastPos = null;
  function rbBoost(p) {   // Jerry and Bryson: RB_SPEED x as far each step of a live play
    const sp = specOf(p[N.pmap]);
    if (!sp || !sp.rb) { rbRefs.delete(p); return; }
    if (!p[N.offense]) { rbLast.delete(p); return; }
    const ctrl = inst(p, N.ctrl);
    if (!ctrl || ctrl[N.state] !== 2) { rbLast.delete(p); return; }
    const last = rbLast.get(p);
    if (last && last.x === p.x && last.y === p.y) return;      // the game hasn't stepped yet
    const vx = num(p[N.hs]), vy = num(p[N.vs]);
    if (Math.hypot(vx, vy) > 0.05) { p.x += vx * (RB_SPEED - 1); p.y += vy * (RB_SPEED - 1); }
    rbLast.set(p, { x: p.x, y: p.y });
  }
  function speedUp(p) {
    const M = getSpeedX();
    if (M <= 1 || !p[N.offense] || !isStar(p[N.pmap])) { lastPos = null; return; }
    const ctrl = inst(p, N.ctrl);
    if (!ctrl || ctrl[N.state] !== 2) { lastPos = null; return; }      // 2 = the play is live
    if (lastPos && lastPos.p === p && lastPos.x === p.x && lastPos.y === p.y) return;   // game hasn't stepped yet
    const vx = num(p[N.hs]), vy = num(p[N.vs]);
    if (Math.hypot(vx, vy) > 0.05) {
      let ex = vx * (M - 1), ey = vy * (M - 1);
      // going for a pass: still full speed, but stop on the catch spot instead of running past it
      if (chasing && chase && autoCatchOn() && chase.steps >= chase.react && chase.tx !== undefined) {
        const dx = chase.tx - p.x, dy = chase.ty - p.y, d = Math.hypot(dx, dy), e = Math.hypot(ex, ey);
        if (e >= d) { p.x = chase.tx; p.y = chase.ty; p[N.hs] = 0; p[N.vs] = 0; p[N.jforce] = 0; ex = ey = 0; }
      }
      p.x += ex; p.y += ey;
    }
    lastPos = { p, x: p.x, y: p.y };
  }

  function hookGame() {
    // Jimmy's look: the game asks his save for skin and face; answer with his look so he
    // is Black with dreads everywhere (old saves too), and flag his face for red eyes
    if (!COLLEGE && typeof window[N.get] === "function" && !window[N.get].__rbJimmy) {
      const og = window[N.get], LOOKK = { skin: 1, face_x: 1, face_y: 1 };
      const g = function (m, k) {
        if (typeof k === "string" && LOOKK[k] === 1) {
          try {
            const tok = og.call(this, m, STAR_KEY);
            if (tok === JIMMY_TOKEN) { if (k === "face_x") jimmyFace = 1; return JIMMY_LOOK[k]; }
            const sp = tok && SPEC_BY_TOKEN[tok];
            if (sp) { if (k === "face_x") specFace = sp; return sp.look[k]; }
          } catch (e) {}
        }
        return og.apply(this, arguments);
      };
      g.__rbJimmy = true; window[N.get] = g;
    }
    if (!COLLEGE && N.drawSpr && typeof window[N.drawSpr] === "function" && !window[N.drawSpr].__rbJimmy) {
      const o9 = window[N.drawSpr];
      const w9 = function (inst, spr, img, x, y, xs, ys, rot, col, a) {
        const r = o9.apply(this, arguments);
        if (specFace) {
          const sp = specFace; specFace = null;
          if (sp.pixels.length && spr === sp.spr && +img === sp.look.face_x && !+rot) {
            const sx = +xs || 1, sy = +ys || 1;
            try { for (const [px, py, c] of sp.pixels) o9.call(this, inst, SQUARE_SPR, 0, +x + px * sx, +y + py * sy, sx / 16, sy / 16, 0, c, a); } catch (e) {}
          }
        }
        if (jimmyFace) {
          jimmyFace = 0;
          if (spr === JIMMY_FACE_SPR && +img === JIMMY_LOOK.face_x && !+rot) {
            const sx = +xs || 1, sy = +ys || 1;
            try { for (const [px, py] of JIMMY_EYES) o9.call(this, inst, SQUARE_SPR, 0, +x + px * sx, +y + py * sy, sx / 16, sy / 16, 0, JIMMY_EYE_COLOR, a); } catch (e) {}
          }
        }
        return r;
      };
      w9.__rbJimmy = true; window[N.drawSpr] = w9;
    }
    // Boswell's kicks go dead centre between the posts
    if (!COLLEGE && typeof window[N.kickAim] === "function" && !window[N.kickAim].__rbAdmin) {
      const ok = window[N.kickAim];
      const wk = function (dm, em) {
        const r = ok.apply(this, arguments);
        try {
          const k = window[N.byId](dm, em, dm[N.kickHolder]);
          if (k && specOf(k[N.pmap]) === SPECIALS.boswell) {
            kickRef = dm;
            if (num(dm[N.kickMeter]) < 55) dm[N.kickMeter] = 55;
            k[N.kickPow] = BOS_POWER;
            return -window[N.pdir](k.x, k.y, dm[N.kickX], 300);   // the middle of the posts
          }
          if (kickRef === dm) kickRef = null;
        } catch (e) {}
        return r;
      };
      wk.__rbAdmin = true; window[N.kickAim] = wk;
    }
    // Jerry and Bryson never get hurt
    if (!COLLEGE && typeof window[N.injure] === "function" && !window[N.injure].__rbAdmin) {
      const oi = window[N.injure];
      const wi = function (dm, em, map) {
        if (window.__rbGodMode) return false;
        const sp = specOf(map);
        if (sp && sp.rb) return false;
        return oi.apply(this, arguments);
      };
      wi.__rbAdmin = true; window[N.injure] = wi;
    }
    // speed: the match reads each player's speed through _Iv1
    if (typeof window[N.speed] === "function" && !window[N.speed].__rbAdmin) {
      const orig = window[N.speed];
      const w = function (a, b, map, stat) {
        const v = orig.apply(this, arguments);
        if (stat === "speed" && map && isStar(map)) return 10 + getBoost();
        if (window.__rbGodMode && (stat === "speed" || stat === "strength" || stat === "skill" || stat === "stamina")) return 10 + getBoost();
        const sp = (stat === "strength" || stat === "speed" || stat === "skill") && map && specOf(map);
        if (sp && !sp.arm) {
          const own = a && typeof a === "object" && a[N.pmap] === map;
          if (sp.rb) { if (own) rbRefs.add(a); if (stat === "strength") return own ? RB_STRENGTH : 10; return 10; }
          if (sp.kicker) { if (own && stat === "strength") bosRef = a; return 10; }
        }
        if (stat === "strength" && map && isArm(map)) {   // Jimmy Sahur's (and LeBron's) arm: 100-yard passes
          if (a && typeof a === "object") {
            if (a[N.pmap] === map) { if (isJimmy(map)) jimmyRef = a; else armRefs.add(a); return JIMMY_ARM; }     // his own strength
            if (a[N.offense] && a[N.commDef] !== map) return JIMMY_RANGE_ARM;   // teammates judging how far his pass will go
          }
          return JIMMY_ARM;   // defenders tackling him, everything else
        }
        return v;
      };
      w.__rbAdmin = true; window[N.speed] = w;
    }
    // no drops for him
    if (typeof window[N.drop] === "function" && !window[N.drop].__rbAdmin) {
      const orig = window[N.drop];
      const w = function (p) { if (window.__rbGodMode || (autoCatchOn() && p && p[N.pmap] && isStar(p[N.pmap]))) return false; return orig.apply(this, arguments); };
      w.__rbAdmin = true; window[N.drop] = w;
    }
    // _tA1 is a receiver's brain (route running): after it decides, send him to the ball
    if (typeof window[N.ai] === "function" && !window[N.ai].__rbAdmin) {
      const orig = window[N.ai];
      const w = function (p) {
        const r = orig.apply(this, arguments);
        try { if (autoCatchOn() && p && p[N.offense] && p[N.pmap] && isStar(p[N.pmap])) runToBall(p); } catch (e) {}
        try { if (window.__rbGodMode && p && p[N.offense]) { if (!window.__rbGodRefs) window.__rbGodRefs = new Set(); window.__rbGodRefs.add(p); } } catch (e) {}
        return r;
      };
      w.__rbAdmin = true; window[N.ai] = w;
    }
    // _tv1 is the catch check, every frame for every player: let him reach, block interceptions
    if (typeof window[N.catchFn] === "function" && !window[N.catchFn].__rbAdmin) {
      const orig = window[N.catchFn];
      const w = function (p) {
        let me = false;
        if (p) { try { me = !!(p[N.pmap] && isStar(p[N.pmap])); if (me) starRef = p; } catch (e) {} }
        if (autoCatchOn() && p) {
          try {
            if (me && p[N.offense]) {
              const ball = passInAir(p);
              if (!ball) { chase = null; chasing = false; }
              else {
                burst(p);
                /* he always catches it: once the ball is coming down into catch range,
                   step him under it (he's the fastest man in the league) */
                const bh = num(ball[N.height]), bz = num(ball[N.zvel]);
                if (bz < 0 && bh <= CATCH_H + 6 && Math.hypot(ball.x - p.x, ball.y - p.y) < 160) {
                  p.x = ball.x; p.y = ball.y; p[N.hs] = 0; p[N.vs] = 0; p[N.jforce] = 0;
                }
              }
            }
          } catch (e) {}
          if (chasing && !me) return false;   // the ball is his: nobody else gets a hand on it
        }
        return orig.apply(this, arguments);
      };
      w.__rbAdmin = true; window[N.catchFn] = w;
    }
  }
  hookGame();
  window.addEventListener("load", hookGame);

  /* ======================= save file ======================= */
  const slotKeys = () => { try { return Object.keys(localStorage).filter(k => k.startsWith(N.savePrefix) && /savedata\d?\.ini$/.test(k)).sort(); } catch (e) { return []; } };
  const slotName = k => "Save " + (((k.match(/savedata(\d?)\.ini$/) || [])[1]) || "1");
  function parseIni(text) {
    const secs = []; let cur = null;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === ";" || line[0] === "#") continue;
      const sm = line.match(/^\[(.*)\]$/);
      if (sm) { cur = { name: sm[1], keys: [], vals: {} }; secs.push(cur); continue; }
      const i = line.indexOf("="); if (i < 0 || !cur) continue;
      const k = line.slice(0, i).trim(); let v = line.slice(i + 1).trim();
      if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in cur.vals)) cur.keys.push(k);
      cur.vals[k] = v;
    }
    return secs;
  }
  function writeIni(secs) {
    let out = "";
    for (const s of secs) {
      out += "[" + s.name + "]\r\n";
      for (const k of s.keys) { const v = String(s.vals[k]); out += v.indexOf('"') < 0 ? k + '="' + v + '"\r\n' : v.indexOf("'") < 0 ? k + "='" + v + "'\r\n" : k + "=" + v + "\r\n"; }
    }
    return out;
  }
  function decodeMap(str) {
    if (!str) return null;
    if (str[0] === "{") { try { return JSON.parse(str); } catch (e) { return null; } }
    const bytes = new Uint8Array(str.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(str.substr(i * 2, 2), 16);
    const dv = new DataView(bytes.buffer); let p = 0;
    const u32 = () => { const v = dv.getUint32(p, true); p += 4; return v; };
    const f64 = () => { const v = dv.getFloat64(p, true); p += 8; return v; };
    const val = () => {
      const t = u32();
      if (t === 0) return f64();
      if (t === 1) { const n = u32(); const s = new TextDecoder().decode(bytes.subarray(p, p + n)); p += n; return s; }
      if (t === 2) { const n = u32(); const a = []; for (let i = 0; i < n; i++) a.push(val()); return a; }
      if (t === 13) return !!f64();
      if (t === 5) return undefined;
      throw new Error("unknown value type " + t);
    };
    try { if (u32() !== 403) throw new Error("unknown version"); const n = u32(), map = {}; for (let i = 0; i < n; i++) { const k = val(); map[k] = val(); } return map; }
    catch (e) { console.warn("rbAdmin: could not read player", e); return null; }
  }
  function encodeMap(map) {
    const parts = [];
    const u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); parts.push(b); };
    const f64 = v => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); parts.push(b); };
    const val = v => {
      if (typeof v === "boolean") { u32(13); f64(v ? 1 : 0); }
      else if (typeof v === "number") { u32(0); f64(v); }
      else if (typeof v === "string") { const b = new TextEncoder().encode(v); u32(1); u32(b.length); parts.push(b); }
      else if (Array.isArray(v)) { u32(2); u32(v.length); v.forEach(val); }
      else u32(5);
    };
    const keys = Object.keys(map); u32(403); u32(keys.length);
    for (const k of keys) { val(k); val(map[k]); }
    let hex = ""; const H = "0123456789ABCDEF";
    for (const b of parts) for (const x of b) hex += H[x >> 4] + H[x & 15];
    return hex;
  }

  /* ======================= state ======================= */
  let unlocked = false, unlockedAt = 0, slot = null, secs = null, game = null, roster = [], dirty = false, note = "";
  function load(key) {
    slot = key; secs = parseIni($ls.get(key) || "");
    game = secs.find(s => s.name === "savegame") || null;
    roster = [];
    if (game) { const n = parseInt(game.vals.roster) || 0; for (let i = 0; i < n; i++) roster.push({ map: decodeMap(game.vals["roster_" + i]) }); }
    dirty = false; note = "";
    /* saves from before the marker: tag the one James Stegall this mod drafted
       (a maxed-out wide receiver), never a regular player who was renamed */
    if (!roster.some(r => isStarMap(r.map))) {
      const old = roster.filter(r => namedStar(r.map) && Number(r.map.position) === 4 && STATS.every(([k]) => num(r.map[k]) >= 10));
      if (old.length === 1) { old[0].map[STAR_KEY] = STAR_TOKEN; dirty = true; note = "James Stegall was updated. Save to keep it."; }
    }
    const jm = roster.find(r => isJimmyMap(r.map));
    if (jm && (Number(jm.map.skin) !== JIMMY_LOOK.skin || Number(jm.map.face_x) !== JIMMY_LOOK.face_x || Number(jm.map.face_y) !== JIMMY_LOOK.face_y)) {
      Object.assign(jm.map, JIMMY_LOOK); dirty = true; note = "Jimmy Sahur's look was updated. Save to keep it.";
    }
    const st = roster.find(r => isStarMap(r.map));
    if (st && (Number(st.map.skin) !== STAR_LOOK.skin || Number(st.map.face_x) !== STAR_LOOK.face_x || Number(st.map.face_y) !== STAR_LOOK.face_y)) {
      Object.assign(st.map, STAR_LOOK); dirty = true; note = "James Stegall's look was updated. Save to keep it.";
    }
  }
  function commit() {
    if (!game) return false;
    const before = $ls.get(slot);
    if (before) $ls.set(BACKUP_KEY + slot, JSON.stringify({ at: Date.now(), data: before }));
    roster.forEach((r, i) => { if (r.map) { const k = "roster_" + i; if (!game.keys.includes(k)) game.keys.push(k); game.vals[k] = encodeMap(r.map); } });
    for (let i = roster.length; game.vals["roster_" + i] !== undefined; i++) { delete game.vals["roster_" + i]; game.keys = game.keys.filter(k => k !== "roster_" + i); }
    game.vals.roster = String(roster.length);
    $ls.set(slot, writeIni(secs));
    dirty = false;
    return true;
  }
  const backupOf = k => { try { return JSON.parse($ls.get(BACKUP_KEY + k)); } catch (e) { return null; } };
  const hasStar = () => roster.some(r => isStarMap(r.map));
  function draftStar() {
    if (!game) return "Start a career first.";
    if (hasStar()) return "James Stegall is already on your team.";
    const base = (roster.find(r => r.map && Number(r.map.position) === 4) || roster.find(r => r.map) || {}).map;
    if (!base) return "Your roster is empty, so there's no player to copy the details from.";
    const p = JSON.parse(JSON.stringify(base));
    delete p[STAR_KEY];
    Object.assign(p, STAR_LOOK, { [STAR_KEY]: STAR_TOKEN, fname: STAR.fname, lname: STAR.lname, position: 4, age: 22, skill: 10, speed: 10, strength: 10, stamina: 10, max_skill: 10, max_speed: 10, max_strength: 10, max_stamina: 10, attitude: 100 });
    for (const k of ["injury_week", "resting", "xp", "xp_gain"]) if (k in p) p[k] = 0;
    if (typeof p.condition === "number") p.condition = 100;
    for (const k of Object.keys(p)) if (/^(stat|season|career)_/.test(k) && typeof p[k] === "number") p[k] = 0;
    roster.push({ map: p }); dirty = true;
    return "";
  }
  const hasJimmy = () => roster.some(r => isJimmyMap(r.map));
  function draftJimmy() {
    if (COLLEGE) return "Jimmy Sahur is only in Retro Bowl.";
    if (!game) return "Start a career first.";
    if (hasJimmy()) return "Jimmy Sahur is already on your team.";
    const base = (roster.find(r => r.map && Number(r.map.position) === 1) || roster.find(r => r.map) || {}).map;
    if (!base) return "Your roster is empty, so there's no player to copy the details from.";
    const p = JSON.parse(JSON.stringify(base));
    delete p[STAR_KEY];
    Object.assign(p, JIMMY_LOOK, { [STAR_KEY]: JIMMY_TOKEN, fname: JIMMY.fname, lname: JIMMY.lname, position: 1, age: 23, skill: 10, speed: 10, strength: 10, stamina: 10, max_skill: 10, max_speed: 10, max_strength: 10, max_stamina: 10, attitude: 100 });
    for (const k of ["injury_week", "resting", "xp", "xp_gain"]) if (k in p) p[k] = 0;
    if (typeof p.condition === "number") p.condition = 100;
    for (const k of Object.keys(p)) if (/^(stat|season|career)_/.test(k) && typeof p[k] === "number") p[k] = 0;
    roster.push({ map: p }); dirty = true;
    return "";
  }
  const hasSpecial = key => roster.some(r => specMapOf(r.map) === SPECIALS[key]);
  function draftSpecial(key) {
    const sp = SPECIALS[key];
    if (!sp) return "Unknown player.";
    if (COLLEGE) return sp.fname + " " + sp.lname + " is only in Retro Bowl.";
    if (!game) return "Start a career first.";
    if (hasSpecial(key)) return sp.fname + " " + sp.lname + " is already on your team.";
    const base = (roster.find(r => r.map && Number(r.map.position) === sp.pos) || roster.find(r => r.map) || {}).map;
    if (!base) return "Your roster is empty, so there's no player to copy the details from.";
    const p = JSON.parse(JSON.stringify(base));
    delete p[STAR_KEY];
    Object.assign(p, sp.look, { [STAR_KEY]: sp.token, fname: sp.fname, lname: sp.lname, position: sp.pos, age: sp.age, skill: 10, speed: 10, strength: 10, stamina: 10, max_skill: 10, max_speed: 10, max_strength: 10, max_stamina: 10, attitude: 100 });
    for (const k of ["injury_week", "resting", "xp", "xp_gain"]) if (k in p) p[k] = 0;
    if (typeof p.condition === "number") p.condition = 100;
    for (const k of Object.keys(p)) if (/^(stat|season|career)_/.test(k) && typeof p[k] === "number") p[k] = 0;
    roster.push({ map: p }); dirty = true;
    return "";
  }
  const overall = m => Math.round((num(m.skill) + num(m.speed) + num(m.strength) + num(m.stamina)) / 4 * 10) / 10;
  function teamName() {
    try { const id = game && game.vals.myteam_id; const m = id != null && game.vals["teamlist_" + id] ? decodeMap(game.vals["teamlist_" + id]) : null; return m && m.name ? String(m.name) : ""; } catch (e) { return ""; }
  }
  /* Adds a promo code's rewards to the loaded save. Returns what was given. */
  function applyRewards(r) {
    const given = [];
    for (const [k, label, kind] of REWARDS) {
      const v = Math.round(num(r[k])); if (!v) continue;
      if (kind === "players") { let n = 0; roster.forEach(x => { if (x.map) { x.map.skill_points = num(x.map.skill_points) + v; n++; } }); if (n) given.push(`+${v} skill points for every player`); continue; }
      if (game.vals[k] === undefined) continue;
      let nv = num(game.vals[k]) + v; if (kind === "pct") nv = clamp(nv, 0, 100);
      game.vals[k] = String(nv); given.push(`${v > 0 ? "+" : ""}${v}${kind === "pct" ? "%" : ""} ${label.replace(" ($M)", "")}${k === "boost_salary_cap" ? "M" : ""}`);
    }
    const each = fn => roster.forEach(x => x.map && fn(x.map));
    if (r.heal) { each(m => { if (typeof m.condition === "number") m.condition = 100; m.injury_week = 0; m.resting = 0; }); given.push("Everyone healed"); }
    if (r.morale) { each(m => { m.attitude = 100; }); given.push("Everyone's morale maxed"); }
    if (r.maxstats) { each(m => { for (const [k] of STATS) { m[k] = 10; m["max_" + k] = 10; } }); given.push("Everyone's stats maxed"); }
    if (r.defmax) { const DEF_POS = [6, 7, 8, 9]; roster.forEach(x => { if (x.map && DEF_POS.includes(num(x.map.position))) { for (const [k] of STATS) { x.map[k] = 10; x.map["max_" + k] = 10; } x.map.attitude = 100; } }); given.push("Defense fully maxed (5 stars)"); }
    if (r.godmode) {
      each(m => { for (const [k] of STATS) { m[k] = 10; m["max_" + k] = 10; } m.attitude = 100; m.condition = 100; m.injury_week = 0; m.resting = 0; });
      window.__rbGodMode = true;
      given.push("Entire team maxed — god speed, no drops, unbreakable");
    }
    for (const c of r.custom || []) {
      if (!c.k || !num(c.v) || game.vals[c.k] === undefined || !/^-?\d+(\.\d+)?$/.test(game.vals[c.k])) continue;
      game.vals[c.k] = String(num(game.vals[c.k]) + num(c.v)); given.push(`${num(c.v) > 0 ? "+" : ""}${num(c.v)} ${c.k.replace(/_/g, " ")}`);
    }
    let star = false;
    if (r.jimmy && !hasJimmy() && !draftJimmy()) given.push("Jimmy Sahur joins your team");
    if (r.special && SPECIALS[r.special] && !hasSpecial(r.special) && !draftSpecial(r.special)) given.push(SPECIALS[r.special].fname + " " + SPECIALS[r.special].lname + " joins your team");
    if (r.stegall && !hasStar() && !draftStar()) { star = true; given.push("James Stegall joins your team"); }
    else if (r.stegall && hasStar()) {
      const m = roster.find(x => isStarMap(x.map)).map;
      for (const [k] of STATS) { m[k] = 10; m["max_" + k] = 10; }
      m.attitude = 100; given.push("James Stegall's stats maxed");
    }
    dirty = true;
    return { given, star };
  }

  /* ======================= styles ======================= */
  const css = `
  #rbA, #rbA * { box-sizing: border-box; font-family: "Silkscreen", "Press Start 2P", ui-monospace, monospace; letter-spacing: .02em; }
  #rbA { --b: rgb(44,104,255); --b2: rgb(64,124,255); --navy: rgb(0,53,149); --y: rgb(210,210,10); --g: rgb(86,216,86); --r: #e8243c;
    position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: rgba(0,0,0,.6); color: #fff; }
  /* Retro Bowl College look: navy, white outlines, gold highlights */
  #rbA.college { --b: rgb(5,50,110); --b2: rgb(18,72,140); --navy: rgb(2,26,62); --y: rgb(214,186,118); --g: rgb(181,158,101); }
  #rbA.college button.p { color: #1c1404; }
  #rbA.college button.p:hover { background: rgb(205,182,124); }
  #rbA.college .tab[aria-pressed=true] { background: var(--b); box-shadow: 4px 4px 0 #000; }
  #rbA .box { width: min(940px, 96vw); height: min(640px, 94vh); display: flex; flex-direction: column; background: var(--b); border: 4px solid #fff; box-shadow: 8px 8px 0 #000; }
  #rbA .title { text-align: center; font-size: 24px; padding: 12px 10px 2px; text-shadow: 3px 3px 0 #000; }
  #rbA .stars i { font-style: normal; text-shadow: none; }
  #rbA .top { display: flex; align-items: center; gap: 10px; padding: 6px 16px 8px; flex-wrap: wrap; }
  #rbA .top .sp { margin-right: auto; font-size: 11px; color: #dfe7ff; }
  #rbA .tabs { display: flex; gap: 8px; padding: 2px 16px 10px; justify-content: center; flex-wrap: wrap; }
  #rbA .tab { padding: 9px 14px; border: 3px solid #fff; background: var(--b); color: #fff; font-size: 13px; text-transform: uppercase; cursor: pointer; box-shadow: 4px 4px 0 var(--navy); }
  #rbA .tab[aria-pressed=true] { color: var(--y); background: var(--navy); box-shadow: 4px 4px 0 #000; }
  #rbA .body { margin: 0 16px; padding: 16px; overflow: auto; flex: 1; border: 3px solid #fff; scrollbar-color: #fff var(--navy); }
  #rbA .help { font-size: 12px; line-height: 1.6; color: #e8eeff; margin: 0 0 14px; }
  #rbA .bar { display: flex; gap: 10px; align-items: center; padding: 12px 16px 14px; flex-wrap: wrap; }
  #rbA .bar .msg { margin-right: auto; color: var(--y); font-size: 12px; text-shadow: 2px 2px 0 var(--navy); max-width: 50%; }
  #rbA button.b { min-height: 38px; padding: 6px 14px; border: 3px solid #fff; background: var(--b); color: #fff; font-size: 12px; text-transform: uppercase; cursor: pointer; box-shadow: 4px 4px 0 var(--navy); }
  #rbA button.b:hover { background: var(--b2); }
  #rbA button.b:active { transform: translate(2px,2px); box-shadow: 2px 2px 0 var(--navy); }
  #rbA button.b:disabled { opacity: .5; cursor: default; transform: none; }
  #rbA button.p { background: var(--g); color: #04310f; }
  #rbA button.p:hover { background: rgb(106,230,106); }
  #rbA button.d { background: var(--r); }
  #rbA button.s { min-height: 30px; padding: 3px 9px; font-size: 11px; box-shadow: 3px 3px 0 #000; }
  #rbA input, #rbA select { height: 34px; padding: 0 10px; border: 0; background: #fff; color: #000; font-size: 13px; width: 100%; outline: none; }
  #rbA input:focus, #rbA select:focus { box-shadow: 0 0 0 3px var(--y); }
  #rbA input[type=number] { text-align: center; }
  #rbA .top select { width: auto; border: 3px solid #fff; background: var(--navy); color: #fff; height: 36px; }
  #rbA fieldset { position: relative; border: 3px solid #fff; margin: 12px 0 20px; padding: 20px 14px 14px; min-width: 0; }
  #rbA legend { padding: 0 8px; font-size: 13px; text-transform: uppercase; background: var(--b); color: #fff; }
  #rbA .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px 18px; }
  #rbA .f { display: grid; gap: 5px; font-size: 12px; }
  #rbA .f b { font-weight: normal; text-transform: uppercase; }
  #rbA .f small { font-size: 10px; color: #cfdaff; line-height: 1.4; }
  #rbA .stat { display: grid; grid-template-columns: 110px 1fr 46px; gap: 10px; align-items: center; font-size: 12px; margin-bottom: 10px; }
  #rbA .stat small { grid-column: 1 / -1; margin-top: -6px; font-size: 10px; color: #cfdaff; }
  #rbA input[type=range] { -webkit-appearance: none; appearance: none; height: 18px; padding: 0; background: #000; border: 3px solid #fff; }
  #rbA input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 24px; background: var(--y); border: 3px solid #fff; cursor: pointer; }
  #rbA input[type=range]::-moz-range-thumb { width: 14px; height: 20px; background: var(--y); border: 3px solid #fff; border-radius: 0; }
  #rbA .val { text-align: center; color: var(--y); font-size: 14px; }
  #rbA .tools { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  #rbA .plist { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  #rbA .pc { text-align: left; padding: 10px 12px; background: var(--navy); border: 3px solid #fff; cursor: pointer; color: #fff; box-shadow: 4px 4px 0 #000; display: grid; gap: 6px; }
  #rbA .pc:hover { background: rgb(10,70,180); }
  #rbA .pc .n { font-size: 13px; text-transform: uppercase; }
  #rbA .pc .m { font-size: 10px; color: #cfdaff; }
  #rbA .bars { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  #rbA .bars span { height: 6px; background: #000; position: relative; }
  #rbA .bars span i { position: absolute; inset: 0 auto 0 0; background: var(--g); }
  #rbA .star { color: var(--y); }
  #rbA .star::after { content: " \\2605"; }
  #rbA .card { border: 3px solid #fff; padding: 16px; margin-bottom: 16px; }
  #rbA .card h3 { margin: 0 0 8px; font-size: 14px; text-transform: uppercase; font-weight: normal; }
  #rbA .card p { margin: 0 0 12px; font-size: 12px; line-height: 1.6; color: #e8eeff; }
  #rbA .row2 { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  #rbA .chk { display: flex; align-items: center; gap: 10px; font-size: 13px; cursor: pointer; }
  #rbA .chk input { width: 24px; height: 24px; }
  #rbA details { border: 3px solid #fff; padding: 10px 14px; margin-top: 10px; }
  #rbA summary { cursor: pointer; font-size: 12px; text-transform: uppercase; }
  #rbA .warn { font-size: 11px; color: var(--y); margin: 10px 0; line-height: 1.5; }
  #rbA .modal { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.5); }
  #rbA .mbox { width: min(440px, 90vw); background: var(--b); border: 4px solid #fff; box-shadow: 8px 8px 0 #000; padding: 20px; display: grid; gap: 14px; text-align: center; }
  #rbA .mbox p { margin: 0; font-size: 13px; line-height: 1.6; }
  #rbA .mbox .row2 { justify-content: center; }
  /* passcode screen */
  #rbA .pass { width: min(440px, 92vw); padding: 0 24px 24px; background: var(--b); border: 4px solid #fff; box-shadow: 8px 8px 0 #000; display: grid; gap: 14px; position: relative; }
  #rbA .pass .title { font-size: 20px; padding: 18px 0 0; }
  #rbA .pass .sub { text-align: center; font-size: 11px; color: #dfe7ff; margin-top: -6px; }
  #rbA .pw { position: relative; }
  #rbA .pw input { height: 48px; font-size: 20px; letter-spacing: .25em; padding: 0 56px 0 14px; text-align: left; }
  #rbA .pw button { position: absolute; right: 6px; top: 6px; height: 36px; min-height: 36px; padding: 0 10px; box-shadow: none; border-width: 2px; font-size: 10px; }
  #rbA .dots { display: flex; justify-content: center; gap: 8px; }
  #rbA .dots i { width: 14px; height: 14px; border: 2px solid #fff; background: var(--g); }
  #rbA .dots i.used { background: var(--r); }
  #rbA .err { color: var(--y); font-size: 12px; min-height: 18px; text-align: center; text-shadow: 2px 2px 0 var(--navy); line-height: 1.5; }
  #rbA .x { position: absolute; top: 8px; right: 8px; min-height: 30px; padding: 2px 9px; }
  #rbA .shake { animation: rbAshake .35s; }
  @keyframes rbAshake { 20%, 60% { transform: translateX(-8px); } 40%, 80% { transform: translateX(8px); } }
    /* promo codes in the admin panel */
  #rbA .codes { display: grid; gap: 12px; margin-bottom: 16px; }
  #rbA .code { display: grid; grid-template-columns: 1fr auto; gap: 8px 14px; align-items: center; border: 3px solid #fff; padding: 12px 14px; background: var(--navy); box-shadow: 4px 4px 0 #000; }
  #rbA .code .cn { font-size: 15px; color: var(--y); letter-spacing: 1px; }
  #rbA .code .cr { grid-column: 1; font-size: 11px; line-height: 1.6; color: #e8eeff; }
  #rbA .code .ca { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 8px; }
  #rbA .code.off { opacity: .55; }
  #rbA .warn2 { border: 3px solid var(--y); color: var(--y); padding: 10px 12px; font-size: 12px; line-height: 1.6; margin-bottom: 14px; }
  #rbA .crow { display: grid; grid-template-columns: 1fr 120px auto; gap: 10px; margin-bottom: 10px; }
  #rbA .steps { margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.8; color: #e8eeff; }
  #rbA .steps code { color: var(--y); font-family: inherit; }
  /* the player-facing promo box */
  #rbA .promo-f .gift { text-align: center; font-size: 12px; line-height: 1.8; }
  #rbA .promo-f ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  #rbA .promo-f li { border: 3px solid #fff; padding: 8px 10px; font-size: 12px; background: var(--navy); }
  #rbA .promo-f .pw input { text-transform: uppercase; letter-spacing: 2px; text-align: center; }
  #rbP { position: fixed; left: 0; top: 50%; transform: translate(-6px, -50%); z-index: 2147483646; writing-mode: vertical-rl; font: 11px Silkscreen, monospace; letter-spacing: 2px; text-transform: uppercase;
    padding: 12px 6px 12px 10px; background: rgb(44,104,255); color: #fff; border: 3px solid #fff; border-left: 0; box-shadow: 4px 4px 0 #000; cursor: pointer; opacity: .85; transition: transform .15s, opacity .15s; }
  #rbP.college { background: rgb(5,50,110); color: rgb(214,186,118); }
  #rbP:hover, #rbP:focus { transform: translate(0, -50%); opacity: 1; outline: none; }
  /* draft-day reveal */
  #rbD { --y: rgb(210,210,10); --b: rgb(44,104,255); --navy: rgb(0,53,149);
    position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; overflow: hidden; color: #fff; font-family: Silkscreen, monospace;
    background: radial-gradient(ellipse at 50% 40%, rgb(20,40,90) 0%, #050b1c 70%); animation: rbDin .35s ease-out; }
  #rbD.college { --y: rgb(214,186,118); --b: rgb(5,50,110); --navy: rgb(2,26,62); background: radial-gradient(ellipse at 50% 40%, rgb(14,62,128) 0%, #020a18 70%); }
  #rbD.out { opacity: 0; transition: opacity .3s; }
  #rbD .spot { position: absolute; inset: -20%; background: conic-gradient(from 200deg at 50% -10%, transparent 0deg, rgba(255,255,255,.07) 8deg, transparent 16deg, transparent 344deg, rgba(255,255,255,.07) 352deg, transparent 360deg); pointer-events: none; }
  #rbD .st { position: relative; width: min(560px, 92vw); max-height: 100vh; display: grid; justify-items: center; gap: 12px; text-align: center; padding: 10px 0; }
  #rbD .ban { font-size: clamp(20px, 4vw, 32px); text-transform: uppercase; color: var(--y); text-shadow: 4px 4px 0 #000; animation: rbDban .6s cubic-bezier(.2,1.4,.4,1) both; }
  #rbD .ann { min-height: 3.6em; font-size: clamp(12px, 2.2vw, 16px); line-height: 1.8; text-shadow: 2px 2px 0 #000; }
  #rbD .card { position: relative; width: min(340px, 86vw); padding: 16px 18px 18px; background: var(--b); border: 4px solid #fff; box-shadow: 8px 8px 0 #000; display: grid; gap: 8px; justify-items: center;
    transform: perspective(700px) rotateY(90deg) scale(.8); opacity: 0; }
  #rbD.show .card { transform: none; opacity: 1; transition: transform .7s cubic-bezier(.2,1.3,.4,1), opacity .2s; }
  #rbD .ctop { width: 100%; display: flex; justify-content: space-between; align-items: center; font-size: 11px; text-transform: uppercase; color: #dfe7ff; }
  #rbD .pos { background: var(--y); color: #000; padding: 3px 8px; font-size: 13px; }
  #rbD .helm { width: 96px; filter: drop-shadow(4px 4px 0 #000); }
  #rbD .nm { font-size: clamp(20px, 4vw, 26px); text-transform: uppercase; text-shadow: 3px 3px 0 #000; }
  #rbD .s5 i { font-style: normal; font-size: 22px; color: var(--y); display: inline-block; transform: scale(0); text-shadow: 2px 2px 0 #000; }
  #rbD.show .s5 i { animation: rbDpop .35s cubic-bezier(.2,1.8,.4,1) forwards; }
  #rbD.show .s5 i:nth-child(1) { animation-delay: .5s } #rbD.show .s5 i:nth-child(2) { animation-delay: .62s } #rbD.show .s5 i:nth-child(3) { animation-delay: .74s }
  #rbD.show .s5 i:nth-child(4) { animation-delay: .86s } #rbD.show .s5 i:nth-child(5) { animation-delay: .98s }
  #rbD .sub { font-size: 11px; text-transform: uppercase; color: #dfe7ff; }
  #rbD .bars { width: 100%; display: grid; gap: 6px; }
  #rbD .br { display: grid; grid-template-columns: 82px 1fr 26px; gap: 8px; align-items: center; font-size: 10px; text-transform: uppercase; text-align: left; }
  #rbD .br b { height: 12px; background: #000; border: 2px solid #fff; display: block; }
  #rbD .br i { display: block; height: 100%; width: 0; background: var(--y); }
  #rbD.show .br i { width: 100%; transition: width .9s steps(10) .6s; }
  #rbD .br em { font-style: normal; color: var(--y); }
  #rbD .tag { font-size: 11px; text-transform: uppercase; color: var(--y); }
  #rbD .stamp { position: absolute; right: -22px; top: 16%; padding: 6px 12px; border: 4px solid #e8243c; color: #e8243c; background: rgba(255,255,255,.92); font-size: 18px; text-transform: uppercase;
    transform: rotate(-14deg) scale(3); opacity: 0; box-shadow: 3px 3px 0 #000; }
  #rbD.college .stamp { border-color: rgb(140,104,30); color: rgb(140,104,30); }
  #rbD.stamped .stamp { transform: rotate(-14deg) scale(1); opacity: 1; transition: transform .25s cubic-bezier(.3,1.6,.5,1), opacity .1s; }
  #rbD .go, #rbD .skip { font: inherit; text-transform: uppercase; color: #fff; background: var(--b); border: 3px solid #fff; box-shadow: 4px 4px 0 #000; cursor: pointer; }
  #rbD .go { min-height: 46px; padding: 8px 18px; font-size: 14px; background: var(--y); color: #000; visibility: hidden; opacity: 0; }
  #rbD.ready .go { visibility: visible; opacity: 1; transition: opacity .3s; }
  #rbD .go:active, #rbD .skip:active { transform: translate(2px,2px); box-shadow: 2px 2px 0 #000; }
  #rbD .skip { position: absolute; right: 16px; top: 16px; padding: 6px 12px; font-size: 11px; z-index: 2; }
  #rbD.ready .skip { display: none; }
  #rbD .conf { position: absolute; inset: 0; pointer-events: none; }
  #rbD .conf i { position: absolute; top: -20px; display: block; animation: rbDfall linear forwards; }
  @media (max-height: 620px) {
    #rbD .st { gap: 7px; } #rbD .ban { font-size: 20px; } #rbD .ann { min-height: 3.2em; font-size: 12px; line-height: 1.6; }
    #rbD .card { padding: 10px 14px 12px; gap: 5px; } #rbD .helm { width: 64px; } #rbD .nm { font-size: 18px; } #rbD .s5 i { font-size: 17px; }
    #rbD .bars { gap: 4px; } #rbD .br b { height: 9px; } #rbD .go { min-height: 38px; font-size: 12px; } }
  @keyframes rbDin { from { opacity: 0 } }
  @keyframes rbDban { from { transform: translateY(-60px) scale(.6); opacity: 0 } }
  @keyframes rbDpop { to { transform: scale(1) } }
  @keyframes rbDfall { to { transform: translateY(110vh) rotate(540deg) } }
`;

  /* ======================= UI plumbing ======================= */
  let root = null, lockTimer = null, tab = "team", editing = null;
  function mount(html) {
    close(true);
    if (!document.getElementById("rbA-font")) { const l = document.createElement("link"); l.id = "rbA-font"; l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Silkscreen&display=swap"; document.head.appendChild(l); }
    if (!document.getElementById("rbA-css")) { const st = document.createElement("style"); st.id = "rbA-css"; st.textContent = css; document.head.appendChild(st); }
    const d = document.createElement("div"); d.id = "rbA"; if (COLLEGE) d.className = "college"; d.innerHTML = html; root = d;
    for (const t of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click", "touchstart", "touchend", "wheel", "pointerdown", "pointerup"]) root.addEventListener(t, e => e.stopPropagation());
    root.addEventListener("keydown", e => { if (e.key === "Escape") { const m = root.querySelector(".modal"); if (m) m.remove(); else tryClose(); } });
    document.body.appendChild(root);
  }
  function close(silent) { if (root) { root.remove(); root = null; } if (!silent) clearInterval(lockTimer); }
  function tryClose() { if (!root || !root.querySelector(".box")) return close(); if (!dirty) return close(); ask("You have changes that aren't saved. Close anyway?", "Close", () => { dirty = false; close(); }, true); }
  function ask(text, okLabel, onOk, danger) {
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<div class="mbox"><p>${text}</p><div class="row2"><button class="b" data-no>Cancel</button><button class="b ${danger ? "d" : "p"}" data-ok>${esc(okLabel)}</button></div></div>`;
    root.appendChild(m);
    m.querySelector("[data-no]").onclick = () => m.remove();
    m.querySelector("[data-ok]").onclick = () => { m.remove(); onOk(); };
    setTimeout(() => m.querySelector("[data-ok]").focus(), 20);
  }
  const msg = t => { const m = root && root.querySelector(".msg"); if (m) m.textContent = t; };
  const mark = t => { dirty = true; msg(t || "Unsaved changes."); const s = root && root.querySelector("[data-save]"); if (s) s.disabled = false; };
  const STARS_C = '<span class="stars"><i style="color:rgb(181,158,101)">&#9733;</i><i>&#9733;</i><i style="color:rgb(181,158,101)">&#9733;</i></span>';
  const STARS_L = COLLEGE ? STARS_C : '<span class="stars"><i style="color:#e8243c">&#9733;</i><i>&#9733;</i><i style="color:rgb(0,53,149)">&#9733;</i></span>';
  const STARS_R = COLLEGE ? STARS_C : '<span class="stars"><i style="color:rgb(0,53,149)">&#9733;</i><i>&#9733;</i><i style="color:#e8243c">&#9733;</i></span>';

  /* ======================= draft-day reveal for James Stegall ======================= */
  const HELMET = ["....XXXXXX....", "..XXXXXXXXXX..", ".XXXXXSSXXXXX.", "XXXXXXSSXXXXXX", "XXXXXXSSXXXXXX", "XXXXXXXXXXGGGG", "XXXXXXXXXXG..G", "XXXXXXXXXXGGGG", ".XXXXXXXXXG..G", "..XXXXXX...GGG"];
  function helmetSvg(main, stripe, mask) {
    let r = ""; HELMET.forEach((row, y) => [...row].forEach((c, x) => { if (c !== ".") r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c === "X" ? main : c === "S" ? stripe : mask}"/>`; }));
    return `<svg viewBox="0 0 14 10" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  }
  function fanfare() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)(), t0 = ac.currentTime + 0.05;
      [[523, 0], [659, .12], [784, .24], [1047, .36], [784, .52], [1047, .64]].forEach(([f, at], i, a) => {
        const o = ac.createOscillator(), g = ac.createGain(), len = i === a.length - 1 ? .7 : .11;
        o.type = "square"; o.frequency.value = f;
        g.gain.setValueAtTime(.0001, t0 + at); g.gain.exponentialRampToValueAtTime(.045, t0 + at + .01); g.gain.exponentialRampToValueAtTime(.0001, t0 + at + len);
        o.connect(g).connect(ac.destination); o.start(t0 + at); o.stop(t0 + at + len + .05);
      });
      setTimeout(() => ac.close(), 2500);
    } catch (e) {}
  }
  /* Plays the announcement, then resolves when the player presses the button. */
  function showDraft(team) {
    return new Promise(done => {
      const T = (team || "your team").toUpperCase();
      const words = COLLEGE
        ? `The No. 1 recruit in the country has made his decision. He's committing to... ${T}!`
        : `With the first pick in the draft, the ${T} select...`;
      const el = document.createElement("div"); el.id = "rbD"; if (COLLEGE) el.className = "college";
      const gold = "rgb(214,186,118)";
      el.innerHTML = `<div class="spot"></div><div class="conf"></div>
        <button class="skip" data-skip>Skip</button>
        <div class="st">
          <div class="ban">${COLLEGE ? "&#9733; National Signing Day &#9733;" : "&#9733; The Draft &#9733;"}</div>
          <div class="ann" aria-live="polite"></div>
          <div class="card">
            <div class="ctop"><span class="pos">WR</span><span>${COLLEGE ? "5-star recruit" : "Round 1 &middot; Pick 1"}</span></div>
            <div class="helm">${helmetSvg("#f4f4f4", COLLEGE ? gold : "#e8243c", "#9aa3b5")}</div>
            <div class="nm">James Stegall</div>
            <div class="s5">${"<i>&#9733;</i>".repeat(5)}</div>
            <div class="sub">Wide receiver &middot; ${COLLEGE ? "Senior" : "Age 22"}</div>
            <div class="bars">${STATS.map(([, l]) => `<div class="br"><span>${l}</span><b><i></i></b><em>10</em></div>`).join("")}</div>
            <div class="tag">Fastest player in the league</div>
            <div class="stamp">${COLLEGE ? "Committed" : "Drafted"}</div>
          </div>
          <button class="go" data-go>Welcome to ${esc(T)}</button>
        </div>`;
      for (const t of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click", "touchstart", "touchend", "wheel", "pointerdown", "pointerup"]) el.addEventListener(t, e => e.stopPropagation());
      document.body.appendChild(el);
      const ann = el.querySelector(".ann"), timers = [];
      const later = (ms, fn) => timers.push(setTimeout(fn, ms));
      let ended = false;
      const confetti = () => {
        const box = el.querySelector(".conf"), cols = COLLEGE ? [gold, "#fff", "rgb(70,120,200)"] : ["#e8243c", "#fff", "rgb(44,104,255)", "rgb(210,210,10)"];
        for (let i = 0; i < 90; i++) { const c = document.createElement("i"); c.style.cssText = `left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-delay:${Math.random() * 1.2}s;animation-duration:${2.4 + Math.random() * 2}s;width:${6 + Math.random() * 6}px;height:${6 + Math.random() * 6}px`; box.appendChild(c); }
      };
      const reveal = () => {
        if (ended) return; ended = true; timers.forEach(clearTimeout);
        ann.textContent = words; el.classList.add("show");
        setTimeout(() => { el.classList.add("stamped"); confetti(); fanfare(); }, 1100);
        setTimeout(() => { el.classList.add("ready"); el.querySelector("[data-go]").focus(); }, 1700);
      };
      later(900, () => { let i = 0; const tick = () => { if (ended) return; ann.textContent = words.slice(0, ++i); if (i < words.length) later(words[i - 1] === "." ? 160 : 38, tick); else later(700, reveal); }; tick(); });
      el.querySelector("[data-skip]").onclick = () => { if (!ended) reveal(); else el.classList.add("stamped", "ready"); };
      el.querySelector("[data-go]").onclick = () => { el.classList.add("out"); setTimeout(() => { el.remove(); done(); }, 300); };
    });
  }

  /* ======================= passcode screen ======================= */
  function askPass() {
    mount(`<form class="pass" autocomplete="off">
      <button type="button" class="b s x" data-x title="Close">X</button>
      <div class="title">${STARS_L} PASSCODE ${STARS_R}</div>
      <div class="sub">Enter the admin passcode</div>
      <div class="pw"><input type="password" autocomplete="off" spellcheck="false" aria-label="Passcode"><button type="button" class="b" data-eye>Show</button></div>
      <div class="dots" title="Tries left"></div>
      <div class="err" aria-live="polite"></div>
      <button class="b p" data-go>Unlock</button></form>`);
    const f = root.querySelector("form"), inp = f.querySelector("input"), err = f.querySelector(".err"), go = f.querySelector("[data-go]"), dots = f.querySelector(".dots");
    root.querySelector("[data-x]").onclick = () => close();
    f.querySelector("[data-eye]").onclick = () => { const show = inp.type === "password"; inp.type = show ? "text" : "password"; f.querySelector("[data-eye]").textContent = show ? "Hide" : "Show"; inp.focus(); };
    let busy = false;
    const paint = () => {
      const s = lockState(), left = Math.max(0, MAX_TRIES - s.fails);
      dots.innerHTML = Array.from({ length: MAX_TRIES }, (_, i) => `<i class="${i >= left ? "used" : ""}"></i>`).join("");
      const wait = s.until - Date.now();
      if (wait > 0) {
        inp.disabled = true; go.disabled = true;
        const m = Math.floor(wait / 60000), sec = Math.ceil((wait % 60000) / 1000);
        err.textContent = `Too many wrong tries. Try again in ${m ? m + "m " : ""}${sec}s.`;
      } else {
        if (inp.disabled) { inp.disabled = false; go.disabled = busy; err.textContent = s.fails ? `${left} ${left === 1 ? "try" : "tries"} left` : ""; inp.focus(); }
        if (s.until && s.fails >= MAX_TRIES) { s.fails = 0; s.until = 0; setLock(s); paint(); }
      }
    };
    paint();
    clearInterval(lockTimer); lockTimer = setInterval(() => { if (!root || !root.querySelector(".pass")) return clearInterval(lockTimer); paint(); }, 500);
    setTimeout(() => inp.focus(), 30);
    f.onsubmit = async e => {
      e.preventDefault();
      if (busy || inp.disabled || !inp.value) return;
      busy = true; go.disabled = true; go.textContent = "Checking...";
      const ok = await checkPass(inp.value);
      busy = false; go.textContent = "Unlock";
      if (!root) return;
      if (ok) { promoKey = adminKeyFrom(inp.value); setLock({ fails: 0, until: 0, round: 0 }); unlocked = true; unlockedAt = Date.now(); clearInterval(lockTimer); openPanel(true); return; }
      const s = lockState(); s.fails++;
      if (s.fails >= MAX_TRIES) { s.until = Date.now() + 60000 * Math.min(60, Math.pow(2, s.round)); s.round++; }
      setLock(s);
      inp.value = ""; f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake");
      go.disabled = false; inp.disabled = false; err.textContent = "";
      paint();
      if (!(s.until > Date.now())) err.textContent = `Wrong passcode. ${Math.max(0, MAX_TRIES - s.fails)} ${MAX_TRIES - s.fails === 1 ? "try" : "tries"} left`;
    };
  }

  /* ======================= main panel ======================= */
  function openPanel(first) {
    const slots = slotKeys();
    if (!slot || !slots.includes(slot)) { if (slots.length) load(slots.find(k => /savedata\.ini$/.test(k)) || slots[0]); else { slot = null; secs = null; game = null; roster = []; } }
    else if (!dirty) load(slot);
    editing = null;
    mount(`<div class="box">
      <div class="title">${STARS_L} ${COLLEGE ? "COLLEGE " : ""}ADMIN ${STARS_R}</div>
      <div class="top"><span class="sp">Changes only apply after "Save &amp; reload". Do it from the game's main menu.</span>
        <select data-slot aria-label="Save slot">${slots.map(k => `<option value="${esc(k)}"${k === slot ? " selected" : ""}>${slotName(k)}</option>`).join("") || "<option>No save yet</option>"}</select>
        <button class="b s" data-lock title="Lock the panel">Lock</button><button class="b s" data-x title="Close">X</button></div>
      <div class="tabs"><button class="tab" data-t="team">Team</button><button class="tab" data-t="players">Players</button><button class="tab" data-t="star">J. Stegall</button><button class="tab" data-t="promo">Promo codes</button><button class="tab" data-t="help">Help</button></div>
      <div class="body"></div>
      <div class="bar"><span class="msg" aria-live="polite"></span><button class="b" data-undo>Undo changes</button><button class="b p" data-save disabled>Save &amp; reload</button></div></div>`);
    root.querySelector("[data-x]").onclick = tryClose;
    root.querySelector("[data-lock]").onclick = () => { const go = () => { unlocked = false; promoKey = ""; dirty = false; close(); }; dirty ? ask("Lock and throw away unsaved changes?", "Lock", go, true) : go(); };
    root.querySelector("[data-slot]").onchange = e => { const k = e.target.value; const go = () => { load(k); render(); }; if (dirty) ask("Switch saves and lose your unsaved changes?", "Switch", go, true); else go(); };
    root.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { tab = b.dataset.t; editing = null; promoEdit = null; render(); });
    root.querySelector("[data-undo]").onclick = () => { if (!dirty) return msg("Nothing to undo."); ask("Throw away all changes since your last save?", "Undo", () => { load(slot); render(); msg("Changes thrown away."); }, true); };
    root.querySelector("[data-save]").onclick = () => {
      if (!game) return msg("There's no career save to change yet.");
      if (commit()) { msg("Saved. Reloading the game..."); setTimeout(() => location.reload(), 400); }
    };
    clearInterval(lockTimer);
    lockTimer = setInterval(() => { if (unlocked && Date.now() - unlockedAt > AUTO_LOCK_MS) { unlocked = false; promoKey = ""; if (root && root.querySelector(".box") && !dirty) close(); } }, 5000);
    render();
    if (note) { msg(note); root.querySelector("[data-save]").disabled = false; }
    if (first && game && !hasStar()) {
      ask("Draft <b class='star'>James Stegall</b>?<br><br>The fastest wide receiver in the league. He outruns everyone and catches every pass.", "Draft him", () => {
        const e = draftStar(); if (e) return msg(e);
        showDraft(teamName()).then(() => { tab = "star"; render(); mark("James Stegall drafted. Press \"Save & reload\" to keep him."); });
      });
    }
  }

  function render() {
    if (!root || !root.querySelector(".box")) return;
    root.querySelectorAll("[data-t]").forEach(b => b.setAttribute("aria-pressed", b.dataset.t === tab));
    const save = root.querySelector("[data-save]"); if (save) save.disabled = !dirty;
    const body = root.querySelector(".body");
    body.scrollTop = 0;
    if (tab === "help") return renderHelp(body);
    if (tab === "promo") return renderPromo(body);
    if (!game) { body.innerHTML = `<p class="help">No career save found in this browser yet. Start a career in ${N.game}, then open this panel again.</p>`; return; }
    if (tab === "team") return renderTeam(body);
    if (tab === "players") return editing ? renderPlayer(body, editing) : renderPlayers(body);
    if (tab === "star") return renderStar(body);
  }

  /* ---------- Team ---------- */
  function renderTeam(body) {
    const shown = new Set();
    let html = `<p class="help">Your team's money, fans and facilities. Type a number or use the arrows.</p>`;
    for (const [title, fields] of TEAM) {
      const items = fields.filter(f => game.vals[f[0]] !== undefined);
      if (!items.length) continue;
      html += `<fieldset><legend>${esc(title)}</legend><div class="grid">` + items.map(([k, label, hint, min, max]) => { shown.add(k);
        return `<label class="f"><b>${esc(label)}</b><input type="number" data-k="${k}" min="${min}" max="${max}" step="1" value="${esc(game.vals[k])}"><small>${esc(hint)}</small></label>`; }).join("") + `</div></fieldset>`;
    }
    const rest = game.keys.filter(k => !shown.has(k) && !LIST_KEYS.test(k) && /^-?\d+(\.\d+)?$/.test(game.vals[k]));
    html += `<details><summary>More values (${rest.length})</summary><p class="warn">These are the game's own settings with their raw names. Changing ones you don't understand can break your save, but you can always undo or restore the backup.</p>
      <input data-q placeholder="Filter, for example week" style="margin-bottom:12px"><div class="grid">` +
      rest.map(k => `<label class="f" data-name="${esc(k)}"><b>${esc(k.replace(/_/g, " "))}</b><input type="number" step="any" data-k="${esc(k)}" value="${esc(game.vals[k])}"></label>`).join("") + `</div></details>`;
    body.innerHTML = html;
    body.querySelectorAll("input[data-k]").forEach(inp => inp.oninput = () => {
      let v = num(inp.value); if (inp.min !== "") v = clamp(v, num(inp.min), num(inp.max));
      game.vals[inp.dataset.k] = String(v); mark();
    });
    const q = body.querySelector("[data-q]");
    if (q) q.oninput = () => { const t = q.value.toLowerCase(); body.querySelectorAll("details .f").forEach(l => l.style.display = l.dataset.name.includes(t) ? "" : "none"); };
  }

  /* ---------- Players list ---------- */
  function renderPlayers(body) {
    const list = roster.map((r, i) => ({ r, i })).filter(x => x.r.map);
    body.innerHTML = `<p class="help">Click a player to change his stats, name, look, health and contract. The buttons below change everyone at once.</p>
      <div class="tools">
        <button class="b s" data-all="max">Max everyone's stats</button>
        <button class="b s" data-all="heal">Heal everyone</button>
        <button class="b s" data-all="morale">Max everyone's morale</button>
        <button class="b s" data-all="young">Make everyone 21</button>
      </div>
      <div class="plist">${list.map(({ r, i }) => { const m = r.map;
        return `<button class="pc" data-i="${i}"><span class="n ${isStarMap(m) ? "star" : ""}">${esc(m.fname)} ${esc(m.lname)}</span>
          <span class="m">${esc(POS[m.position] || m.position)} &middot; Age ${esc(m.age)} &middot; Overall ${overall(m)}${num(m.injury_week) > 0 ? " &middot; Injured" : ""}</span>
          <span class="bars">${STATS.map(([k]) => `<span title="${k} ${esc(m[k])}"><i style="width:${clamp(num(m[k]), 0, 10) * 10}%"></i></span>`).join("")}</span></button>`; }).join("")}</div>`;
    body.querySelectorAll(".pc").forEach(b => b.onclick = () => { editing = roster[+b.dataset.i]; render(); });
    const all = {
      max: ["Set every player's skill, speed, strength and stamina to 10?", m => { for (const [k] of STATS) { m[k] = 10; m["max_" + k] = 10; } }, "Everyone's stats are maxed."],
      heal: ["Heal everyone and clear injuries?", m => { if (typeof m.condition === "number") m.condition = 100; m.injury_week = 0; m.resting = 0; }, "Everyone is healed."],
      morale: ["Set everyone's morale to 100?", m => { m.attitude = 100; }, "Everyone's morale is 100."],
      young: ["Set every player's age to 21?", m => { m.age = 21; }, "Everyone is 21 now."] };
    body.querySelectorAll("[data-all]").forEach(b => b.onclick = () => { const [q, fn, done] = all[b.dataset.all]; ask(q, "Do it", () => { roster.forEach(r => r.map && fn(r.map)); mark(done + " Press \"Save & reload\" to keep it."); render(); }); });
  }

  /* ---------- One player ---------- */
  function renderPlayer(body, r) {
    const m = r.map, star = isStarMap(m);
    const faceMax = (FACE_ROWS[num(m.skin)] || 1) - 1;
    const statRow = (k, label, hint, prefix) => `<div class="stat"><span>${label}</span><input type="range" min="1" max="10" step="1" data-s="${prefix}${k}" value="${clamp(num(m[prefix + k]) || 1, 1, 10)}"><span class="val" data-v="${prefix}${k}">${clamp(num(m[prefix + k]) || 1, 1, 10)}</span>${hint ? `<small>${hint}</small>` : ""}</div>`;
    const field = (k, label, hint, type, min, max) => m[k] === undefined ? "" : `<label class="f"><b>${label}</b><input ${type === "text" ? 'type="text"' : `type="number" min="${min}" max="${max}" step="1"`} data-f="${k}" value="${esc(m[k])}"><small>${hint}</small></label>`;
    const extra = Object.keys(m).filter(k => (typeof m[k] === "number" || typeof m[k] === "string") && !["fname", "lname", "position", "age", "skin", "face_x", "face_y", "condition", "attitude", "injury_week", "resting", "contract", "salary", "skill_points", "xp", "xp_level"].includes(k) && !STATS.some(s => s[0] === k || "max_" + s[0] === k)).sort();
    body.innerHTML = `<div class="row2" style="margin-bottom:12px"><button class="b s" data-back>&lt; All players</button>
        <b class="${star ? "star" : ""}" style="font-weight:normal;font-size:15px;margin-right:auto">${esc(m.fname)} ${esc(m.lname)}</b>
        <button class="b s" data-max>Max stats</button><button class="b s d" data-cut ${star ? "disabled title='James Stegall stays on the team'" : ""}>Cut player</button></div>
      <fieldset><legend>Stats (1 to 10)</legend>${STATS.map(([k, l, h]) => statRow(k, l, h, "")).join("")}
        ${star ? `<p class="warn">James Stegall's match speed and catching are set in the J. Stegall tab.</p>` : ""}</fieldset>
      <fieldset><legend>Potential (highest each stat can grow)</legend>${STATS.map(([k, l]) => statRow(k, l, "", "max_")).join("")}</fieldset>
      <fieldset><legend>Player</legend><div class="grid">
        ${field("fname", "First name", "Shown on his card", "text")}
        ${field("lname", "Last name", star ? "His powers stay even if you rename him" : "Shown on his card", "text")}
        <label class="f"><b>Position</b><select data-f="position">${Object.keys(POS_NAME).filter(k => k !== "9").map(k => `<option value="${k}"${Number(m.position) === Number(k) || (k === "8" && Number(m.position) === 9) ? " selected" : ""}>${POS[k]} - ${POS_NAME[k]}</option>`).join("")}</select><small>Where he plays</small></label>
        ${field("age", "Age", "18 to 40. Older players decline", "number", 18, 40)}
      </div></fieldset>
      <fieldset><legend>Health and morale</legend><div class="grid">
        ${field("condition", "Condition", "0 to 100. How fit he is right now", "number", 0, 100)}
        ${field("attitude", "Morale", "0 to 100. Unhappy players play worse", "number", 0, 100)}
        ${field("injury_week", "Weeks injured", "0 means healthy", "number", 0, 20)}
      </div></fieldset>
      <fieldset><legend>Contract and progress</legend><div class="grid">
        ${field("salary", "Salary ($M)", "Counts against the salary cap", "number", 0, 99)}
        ${field("contract", "Contract years", "Years left on his deal", "number", 0, 10)}
        ${field("skill_points", "Skill points", "Points you can spend to improve him", "number", 0, 99)}
        ${field("xp_level", "Level", "His experience level", "number", 0, 99)}
      </div></fieldset>
      <fieldset><legend>Look</legend><div class="grid">
        <label class="f"><b>Skin tone</b><select data-f="skin"><option value="0">Dark</option><option value="1">Tan</option><option value="2">White</option></select><small>${star ? "James Stegall's look resets to his own each time you open the panel" : "Changes his face options too"}</small></label>
        ${field("face_x", "Face", "0 to 7", "number", 0, 7)}
        <label class="f"><b>Face row</b><input type="number" data-f="face_y" min="0" max="${faceMax}" step="1" value="${esc(clamp(num(m.face_y), 0, faceMax))}"><small>0 to ${faceMax} for this skin tone</small></label>
      </div></fieldset>
      <details><summary>All other values (${extra.length})</summary><p class="warn">Season and career numbers and other raw values.</p><div class="grid">
        ${extra.map(k => `<label class="f"><b>${esc(k.replace(/_/g, " "))}</b><input ${typeof m[k] === "number" ? 'type="number" step="any"' : 'type="text"'} data-x="${esc(k)}" value="${esc(m[k])}"></label>`).join("")}
      </div></details>`;
    const sk = body.querySelector('[data-f="skin"]'); if (sk) sk.value = String(clamp(num(m.skin), 0, 2));
    body.querySelector("[data-back]").onclick = () => { editing = null; render(); };
    body.querySelectorAll("input[type=range]").forEach(inp => inp.oninput = () => {
      const k = inp.dataset.s, v = num(inp.value); m[k] = v;
      body.querySelector(`[data-v="${k}"]`).textContent = v;
      if (!k.startsWith("max_") && num(m["max_" + k]) < v) { m["max_" + k] = v; const o = body.querySelector(`[data-s="max_${k}"]`); if (o) { o.value = v; body.querySelector(`[data-v="max_${k}"]`).textContent = v; } }
      if (k.startsWith("max_") && num(m[k.slice(4)]) > v) { m[k.slice(4)] = v; const o = body.querySelector(`[data-s="${k.slice(4)}"]`); if (o) { o.value = v; body.querySelector(`[data-v="${k.slice(4)}"]`).textContent = v; } }
      mark();
    });
    body.querySelectorAll("[data-f]").forEach(inp => inp.oninput = inp.onchange = () => {
      const k = inp.dataset.f;
      if (inp.type === "text") m[k] = inp.value.slice(0, 20);
      else { let v = num(inp.value); if (inp.min !== "" && inp.min !== undefined && inp.max) v = clamp(v, num(inp.min), num(inp.max)); m[k] = v; }
      if (k === "skin") { const fm = (FACE_ROWS[m.skin] || 1) - 1; if (num(m.face_y) > fm) m.face_y = fm; renderPlayer(body, r); }
      mark();
    });
    body.querySelectorAll("[data-x]").forEach(inp => inp.oninput = () => { const k = inp.dataset.x; m[k] = typeof m[k] === "number" ? num(inp.value) : inp.value; mark(); });
    body.querySelector("[data-max]").onclick = () => { for (const [k] of STATS) { m[k] = 10; m["max_" + k] = 10; } mark(); renderPlayer(body, r); };
    const cut = body.querySelector("[data-cut]");
    if (cut && !star) cut.onclick = () => ask(`Cut ${esc(m.fname)} ${esc(m.lname)} from your team?`, "Cut", () => { roster.splice(roster.indexOf(r), 1); editing = null; mark("Player cut. Press \"Save & reload\" to keep it."); render(); }, true);
  }

  /* ---------- James Stegall ---------- */
  function renderStar(body) {
    const boost = getBoost(), x = v => (1 + v * 0.002 / 0.125).toFixed(1);
    body.innerHTML = `<p class="help">Your secret weapon. These settings take effect in your next match and don't need saving.</p>
      <div class="card"><h3>${hasStar() ? "On your team" : "Not on your team yet"}</h3>
        <p>${hasStar() ? "James Stegall, wide receiver. White, clean-shaven, black hair with bangs." : "Draft him to add him to your roster with maxed stats."}</p>
        ${hasStar() ? "" : `<button class="b p" data-draft>Draft James Stegall</button>`}</div>
      ${COLLEGE ? "" : `<div class="card"><h3>Jimmy Sahur ${hasJimmy() ? "(on your team)" : ""}</h3>
        <p>Quarterback with the longest throwing range in the game (a full-power pass goes about 100 yards, when a normal QB tops out around 33), maxed stats.</p>
        ${hasJimmy() ? "" : `<button class="b p" data-jimmy>Draft Jimmy Sahur</button>`}</div>`}
      <div class="card"><h3>Always catch</h3>
        <p>On passing plays he reads the ball, breaks off his route and runs to where it will come down, timing it to arrive just as it drops. He never drops it, and nobody else (defenders or teammates) can grab it while he's going for it.</p>
        <label class="chk"><input type="checkbox" data-ac ${autoCatchOn() ? "checked" : ""}> Turned on</label></div>

      <div class="card"><h3>Top speed</h3>
        <p>How many times faster he runs than he normally would, with or without the ball. Starts at 10x.</p>
        <div class="stat" style="grid-template-columns:1fr 70px"><input type="range" min="1" max="15" step="1" value="${getSpeedX()}" data-speedx><span class="val" data-sx>${getSpeedX()}x</span></div></div>
      <div class="card"><h3>Acceleration</h3>
        <p>How quickly he gets up to speed.</p>
        <div class="stat" style="grid-template-columns:1fr 70px"><input type="range" min="0" max="300" step="5" value="${boost}" data-boost><span class="val" data-bx>${x(boost)}x</span></div></div>`;
    const d = body.querySelector("[data-draft]");
    if (d) d.onclick = () => { const e = draftStar(); if (e) return msg(e); showDraft(teamName()).then(() => { mark("James Stegall drafted. Press \"Save & reload\" to keep him."); render(); }); };
    const jd = body.querySelector("[data-jimmy]");
    if (jd) jd.onclick = () => { const e = draftJimmy(); if (e) return msg(e); mark("Jimmy Sahur drafted. Press \"Save & reload\" to keep him."); render(); };
    body.querySelector("[data-ac]").onchange = e => { $ls.set(CATCH_KEY, e.target.checked ? "1" : "0"); msg(e.target.checked ? "Always catch is on." : "Always catch is off."); };
    const b = body.querySelector("[data-boost]");
    b.oninput = () => { $ls.set(BOOST_KEY, b.value); body.querySelector("[data-bx]").textContent = x(b.value) + "x"; };
    const sx = body.querySelector("[data-speedx]");
    sx.oninput = () => { $ls.set(SPEEDX_KEY, sx.value); body.querySelector("[data-sx]").textContent = sx.value + "x"; };
  }

  /* ---------- Promo codes (admin) ---------- */
  let promoKey = "", promo = null, promoFile = null, promoDirty = false, promoEdit = null, promoLoading = false;
  const keepDraft = () => { $ls.set(PROMO_DRAFT, JSON.stringify(promo)); promoDirty = true; };
  async function loadPromoAdmin() {
    promoLoading = true;
    promoFile = await fetchPromo();
    let draft = null; try { draft = JSON.parse($ls.get(PROMO_DRAFT)); } catch (e) {}
    if (draft && Array.isArray(draft.codes)) { promo = draft; promoDirty = true; }
    else { promo = promoFile ? JSON.parse(JSON.stringify(promoFile)) : { v: 1, game: N.game, button: true, codes: [] }; promoDirty = false; }
    promoLoading = false;
  }
  const folderName = () => decodeURIComponent((location.pathname.match(/\/([^/]+)\/(?:index\.html)?$/) || [])[1] || (COLLEGE ? "retro-bowl-college" : "retro-bowl"));
  function renderPromo(body) {
    if (!promo) { body.innerHTML = `<p class="help">Loading promo codes...</p>`; if (!promoLoading) loadPromoAdmin().then(() => { if (tab === "promo") render(); }); return; }
    if (promoEdit) return renderPromoEdit(body);
    const today = new Date().toISOString().slice(0, 10);
    body.innerHTML = `<p class="help">Make codes that anyone can type in to get rewards. Players open the code box with the PROMO tab on the left edge of the game, or with Ctrl + Alt + P.</p>
      ${promoDirty ? `<div class="warn2">You have changes that aren't in the uploaded file yet. Press "Save file" and upload it, or players won't see them.</div>` : ""}
      <div class="codes">${promo.codes.length ? promo.codes.map((e, i) => { const name = showName(e, promoKey), old = e.exp && e.exp < today;
        return `<div class="code${old ? " off" : ""}"><span class="cn">${name ? esc(name) : "Hidden code"}</span>
          <span class="cr">${esc(describeRewards(e.r).join(" · ") || "No rewards")}${e.msg ? `<br>Message: "${esc(e.msg)}"` : ""}<br>${e.exp ? (old ? "Expired " : "Works until ") + esc(e.exp) : "Never expires"}${name ? "" : " · made with a different passcode"}</span>
          <span class="ca"><button class="b s" data-ed="${i}">Edit</button><button class="b s d" data-del="${i}">Delete</button></span></div>`; }).join("") : `<p class="help">No codes yet.</p>`}</div>
      <div class="tools"><button class="b p" data-new>New code</button><button class="b" data-file>Save file</button>${promoDirty && promoFile ? `<button class="b" data-revert>Undo code changes</button>` : ""}</div>
      <label class="chk" style="margin-bottom:16px"><input type="checkbox" data-btn ${promo.button !== false ? "checked" : ""}> Show the PROMO tab to players</label>
      <div class="card"><h3>Getting codes to every computer</h3>
        <ol class="steps"><li>Make or change codes here, then press <code>Save file</code>.</li>
          <li>Put <code>promo-codes.json</code> in the <code>g/${esc(folderName())}</code> folder, next to rb-admin.js.</li>
          <li>Upload that file to AWS. Every computer that opens ${N.game} gets the new codes right away.</li></ol>
        <p style="margin-top:12px">${promoFile ? `The game can see a promo-codes.json with ${promoFile.codes.length} code${promoFile.codes.length === 1 ? "" : "s"} right now.` : "The game can't find a promo-codes.json yet, so no codes work until you add one."}
        Codes are stored scrambled, so nobody can read them from the file. Each code works once per save, and only on the save it was used on.</p></div>`;
    body.querySelector("[data-new]").onclick = () => { promoEdit = { i: -1, name: "", e: { r: {}, exp: "", msg: "" } }; render(); };
    body.querySelector("[data-file]").onclick = savePromoFile;
    const rv = body.querySelector("[data-revert]");
    if (rv) rv.onclick = () => ask("Throw away code changes and go back to the uploaded file?", "Undo", () => { try { localStorage.removeItem(PROMO_DRAFT); } catch (e) {} promo = JSON.parse(JSON.stringify(promoFile)); promoDirty = false; render(); }, true);
    body.querySelector("[data-btn]").onchange = e => { promo.button = e.target.checked; keepDraft(); render(); };
    body.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => { const i = +b.dataset.ed, e = promo.codes[i]; promoEdit = { i, name: showName(e, promoKey) || "", e: JSON.parse(JSON.stringify(e)) }; render(); });
    body.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { const i = +b.dataset.del; ask(`Delete the code <b>${esc(showName(promo.codes[i], promoKey) || "Hidden code")}</b>?`, "Delete", () => { promo.codes.splice(i, 1); keepDraft(); render(); msg("Code deleted. Save the file and upload it to finish."); }, true); });
  }
  function renderPromoEdit(body) {
    const ed = promoEdit, r = ed.e.r || (ed.e.r = {}), custom = (r.custom || []).slice(0, 6);
    const keys = game ? game.keys.filter(k => !LIST_KEYS.test(k) && /^-?\d+(\.\d+)?$/.test(game.vals[k])) : [];
    body.innerHTML = `<p class="help">${ed.i < 0 ? "New code" : "Edit code"}. Pick what it gives. Leave a box empty or at 0 to skip it.</p>
      <fieldset><legend>Code</legend><div class="grid">
        <label class="f"><b>Code</b><input data-name maxlength="24" value="${esc(ed.name)}" placeholder="for example STEGALL26" style="text-transform:uppercase;letter-spacing:2px"><small>3 to 24 letters or numbers. Players type this.</small></label>
        <label class="f"><b>Works until</b><input type="date" data-exp value="${esc(ed.e.exp || "")}"><small>Leave empty to never expire</small></label>
        <label class="f"><b>Message to players</b><input data-msg maxlength="80" value="${esc(ed.e.msg || "")}" placeholder="optional"><small>Shown when they redeem it</small></label></div></fieldset>
      <fieldset><legend>Gives</legend><div class="grid">${REWARDS.map(([k, label, kind, min, max]) => `<label class="f"><b>${esc(label)}</b><input type="number" data-rw="${k}" min="${min}" max="${max}" step="1" value="${r[k] ? esc(r[k]) : ""}" placeholder="0"><small>${kind === "players" ? "Added to every player" : kind === "pct" ? "Added, up to 100" : "Added to what they have"}</small></label>`).join("")}</div>
        <div style="display:grid;gap:10px;margin-top:16px">${REWARD_FLAGS.map(([k, label]) => `<label class="chk"><input type="checkbox" data-fl="${k}" ${r[k] ? "checked" : ""}> ${esc(label)}</label>`).join("")}</div></fieldset>
      <fieldset><legend>Any other save value</legend>
        <p class="help">Adds an amount to one of the game's own values, using its raw name.</p>
        <datalist id="rbA-keys">${keys.map(k => `<option value="${esc(k)}">`).join("")}</datalist>
        <div data-rows>${custom.map((c, i) => `<div class="crow"><input list="rbA-keys" data-ck="${i}" value="${esc(c.k)}" placeholder="value name"><input type="number" data-cv="${i}" value="${esc(c.v)}" placeholder="amount"><button class="b s d" data-cx="${i}">X</button></div>`).join("")}</div>
        ${custom.length < 6 ? `<button class="b s" data-cadd>Add a value</button>` : ""}</fieldset>
      <div class="tools"><button class="b" data-cancel>Cancel</button><button class="b p" data-ok>Save code</button></div>`;
    const read = () => {
      ed.name = body.querySelector("[data-name]").value; ed.e.exp = body.querySelector("[data-exp]").value; ed.e.msg = body.querySelector("[data-msg]").value.trim();
      body.querySelectorAll("[data-rw]").forEach(inp => { const v = Math.round(num(inp.value)); if (v) r[inp.dataset.rw] = clamp(v, num(inp.min), num(inp.max)); else delete r[inp.dataset.rw]; });
      body.querySelectorAll("[data-fl]").forEach(c => { if (c.checked) r[c.dataset.fl] = true; else delete r[c.dataset.fl]; });
      r.custom = [...body.querySelectorAll("[data-ck]")].map(k => ({ k: k.value.trim(), v: num(body.querySelector(`[data-cv="${k.dataset.ck}"]`).value) }));
    };
    const cadd = body.querySelector("[data-cadd]"); if (cadd) cadd.onclick = () => { read(); r.custom.push({ k: "", v: "" }); render(); };
    body.querySelectorAll("[data-cx]").forEach(b => b.onclick = () => { read(); r.custom.splice(+b.dataset.cx, 1); render(); });
    body.querySelector("[data-cancel]").onclick = () => { promoEdit = null; render(); };
    body.querySelector("[data-ok]").onclick = () => {
      read();
      const code = normCode(ed.name);
      if (code.length < 3 || code.length > 24) return msg("The code needs 3 to 24 letters or numbers.");
      r.custom = r.custom.filter(c => c.k && num(c.v)); if (!r.custom.length) delete r.custom;
      if (!describeRewards(r).length) return msg("Pick at least one reward.");
      const h = codeHash(code);
      if (promo.codes.some((e, i) => i !== ed.i && e.h === h)) return msg("That code already exists.");
      const s = Math.random().toString(16).slice(2, 10);
      const entry = { h, s, c: hideName(code, promoKey, s), r, exp: ed.e.exp || "", msg: ed.e.msg || "" };
      if (ed.i < 0) promo.codes.push(entry); else promo.codes[ed.i] = entry;
      keepDraft(); promoEdit = null; render();
      msg(`Code ${code} saved. Press "Save file" and upload it so players can use it.`);
    };
  }
  async function savePromoFile() {
    const data = JSON.stringify({ v: 1, game: N.game, button: promo.button !== false, codes: promo.codes }, null, 1);
    const finished = how => { try { localStorage.removeItem(PROMO_DRAFT); } catch (e) {} promoDirty = false; promoFile = JSON.parse(data); render(); msg(how + ` Now put it in g/${folderName()} and upload it to AWS.`); };
    try {
      if (window.showSaveFilePicker) {
        const h = await window.showSaveFilePicker({ suggestedName: PROMO_FILE, types: [{ description: "Promo codes", accept: { "application/json": [".json"] } }] });
        const w = await h.createWritable(); await w.write(data); await w.close(); return finished("Saved promo-codes.json.");
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "application/json" })); a.download = PROMO_FILE;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    finished("promo-codes.json is in your Downloads.");
  }

  /* ---------- Promo codes (players) ---------- */
  const redeemedFor = k => { try { return (JSON.parse($ls.get(REDEEMED)) || {})[k] || []; } catch (e) { return []; } };
  const markRedeemed = (k, h) => { let all = {}; try { all = JSON.parse($ls.get(REDEEMED)) || {}; } catch (e) {} (all[k] = all[k] || []).push(h); $ls.set(REDEEMED, JSON.stringify(all)); };
  const promoLock = () => { try { return JSON.parse($ls.get(PROMO_LK)) || { fails: 0, until: 0, round: 0 }; } catch (e) { return { fails: 0, until: 0, round: 0 }; } };
  function openRedeem() {
    if (root) return;
    const slots = slotKeys();
    mount(`<form class="pass promo-f" autocomplete="off">
      <button type="button" class="b s x" data-x title="Close">X</button>
      <div class="title">${STARS_L} PROMO CODE ${STARS_R}</div>
      <div class="sub">Type a code to claim a reward</div>
      <div data-step>
        <div class="pw" style="grid-template-columns:1fr"><input maxlength="32" spellcheck="false" aria-label="Promo code" placeholder="CODE"></div>
        ${slots.length > 1 ? `<label class="f" style="margin-top:12px"><b>Save</b><select data-s>${slots.map(k => `<option value="${esc(k)}">${slotName(k)}</option>`).join("")}</select></label>` : ""}
        <div class="err" aria-live="polite" style="margin-top:10px"></div>
        <button class="b p" data-go style="width:100%;margin-top:10px">Redeem</button></div></form>`);
    const f = root.querySelector("form"), step = f.querySelector("[data-step]"), inp = f.querySelector("input"), err = f.querySelector(".err"), go = f.querySelector("[data-go]");
    root.querySelector("[data-x]").onclick = () => close();
    setTimeout(() => inp.focus(), 30);
    f.onsubmit = async e => {
      e.preventDefault();
      const lk = promoLock(), wait = lk.until - Date.now();
      if (wait > 0) { err.textContent = `Too many wrong codes. Try again in ${Math.ceil(wait / 1000)}s.`; return; }
      const code = normCode(inp.value); if (!code) return;
      if (!slots.length) { err.textContent = `Start a career in ${N.game} first, then come back with your code.`; return; }
      go.disabled = true; go.textContent = "Checking...";
      const file = await fetchPromo(); const h = codeHash(code);
      go.disabled = false; go.textContent = "Redeem";
      if (!root) return;
      const entry = BUILTIN.find(c => c.h === h) || (file && file.codes.find(c => c.h === h));
      if (!entry) {
        lk.fails++; if (lk.fails >= 5) { lk.until = Date.now() + 30000 * Math.pow(2, Math.min(lk.round, 5)); lk.round++; lk.fails = 0; }
        $ls.set(PROMO_LK, JSON.stringify(lk)); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake");
        err.textContent = "That code doesn't work."; return;
      }
      $ls.set(PROMO_LK, JSON.stringify({ fails: 0, until: 0, round: lk.round }));
      if (entry.exp && entry.exp < new Date().toISOString().slice(0, 10)) { err.textContent = "That code has expired."; return; }
      const sk = (f.querySelector("[data-s]") || {}).value || slots[0];
      if (redeemedFor(sk).includes(h)) { err.textContent = "You've already used this code on this save."; return; }
      const claim = async () => {
        load(sk);
        if (!game) { close(); return; }
        const res = applyRewards(entry.r);
        if (res.star) await showDraft(teamName());
        commit(); markRedeemed(sk, h);
        if (root) step.innerHTML = `<div class="gift">Claimed! Reloading the game...</div>`;
        setTimeout(() => location.reload(), 700);
      };
      /* built-in codes apply straight away: no Claim button, the game just reloads */
      if (entry.instant) {
        step.innerHTML = `<div class="gift">${entry.msg ? esc(entry.msg) + "<br>" : ""}You got:</div>
          <ul>${describeRewards(entry.r).map(t => `<li>${esc(t)}</li>`).join("")}</ul>`;
        await claim();
        return;
      }
      step.innerHTML = `<div class="gift">${entry.msg ? esc(entry.msg) + "<br>" : ""}This code gives you:</div>
        <ul>${describeRewards(entry.r).map(t => `<li>${esc(t)}</li>`).join("")}</ul>
        <p class="sub" style="margin:12px 0 0;line-height:1.6">Claim it from the main menu, not during a match. The game reloads with your rewards.</p>
        <button type="button" class="b p" data-claim style="width:100%;margin-top:12px">Claim</button>`;
      step.querySelector("[data-claim]").onclick = claim;
    };
  }
  /* the PROMO tab on the left edge, only when there are codes and the admin allows it */
  async function promoButton() {
    if (!COLLEGE) return;   /* Retro Bowl uses the PROMO CODE button on its Options screen instead of this side tab */
    const file = await fetchPromo();
    if ((file && file.button === false) || document.getElementById("rbP")) return;   /* always there: DISCORD.GG/LUNACY is built in */
    if (!document.getElementById("rbA-font")) { const l = document.createElement("link"); l.id = "rbA-font"; l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Silkscreen&display=swap"; document.head.appendChild(l); }
    if (!document.getElementById("rbA-css")) { const st = document.createElement("style"); st.id = "rbA-css"; st.textContent = css; document.head.appendChild(st); }
    const b = document.createElement("button"); b.id = "rbP"; b.type = "button"; b.textContent = "Promo"; b.title = "Enter a promo code (Ctrl + 1)"; if (COLLEGE) b.className = "college";
    for (const t of ["mousedown", "mouseup", "touchstart", "touchend", "pointerdown", "pointerup"]) b.addEventListener(t, e => e.stopPropagation());
    b.onclick = e => { e.stopPropagation(); openRedeem(); };
    document.body.appendChild(b);
  }

  /* ---------- PROMO CODE button on Retro Bowl's Options screen ----------
     The Options screen (opened with the wrench) is part of the game's own picture,
     so this sits on top of it: a PROMO CODE row with an ENTER button in the empty
     4th row on the right, drawn like the game's own rows. It only shows on that screen, recognised by its layout: the
     white reddit box at the bottom right and the empty blue spaces around the rows. */
  function menuPromo() {
    if (COLLEGE || document.getElementById("rbM")) return;
    /* Drawn like the game's own buttons, measured from FRONT OFFICE: a white border
       2 game-pixels thick with stepped pixel corners, a solid #333 shadow offset
       2 pixels down and left, the background blue inside, and white pixel lettering.
       --g is one game pixel on screen, so it matches at every screen size. */
    const notch = n => `polygon(${n} 0,calc(100% - ${n}) 0,calc(100% - ${n}) ${n},100% ${n},100% calc(100% - ${n}),calc(100% - ${n}) calc(100% - ${n}),calc(100% - ${n}) 100%,${n} 100%,${n} calc(100% - ${n}),0 calc(100% - ${n}),0 ${n},${n} ${n})`;
    const st = document.createElement("style");
    st.textContent = `#rbM{position:fixed;z-index:2147483000;display:none;padding:0;margin:0;border:0;background:none;cursor:pointer;
      -webkit-tap-highlight-color:transparent;touch-action:manipulation;--g:2px}
      #rbM.on{display:block}
      #rbM i{position:absolute;display:block;pointer-events:none}
      #rbM .sh{left:calc(var(--g) * -2);top:calc(var(--g) * 2);width:100%;height:100%;background:#333;clip-path:${notch("calc(var(--g) * 2)")}}
      #rbM .bd{inset:0;background:#fff;clip-path:${notch("calc(var(--g) * 2)")}}
      #rbM .in{inset:calc(var(--g) * 2);background:#2c68ff;clip-path:${notch("calc(var(--g) * 2)")}}
      #rbM .tx{inset:0;display:flex;align-items:center;justify-content:center;color:#fff;white-space:nowrap;
        font:700 calc(var(--g) * 12)/1 "Silkscreen","Courier New",monospace;letter-spacing:calc(var(--g) * 0.6);padding-left:calc(var(--g) * 0.6)}
      #rbM:active .bd,#rbM:active .in,#rbM:active .tx{transform:translateY(var(--g))}
      #rbMc{position:fixed;z-index:2147482999;display:none;background:#2c68ff;pointer-events:none;color:#fff;white-space:nowrap;
        text-align:right;font:700 calc(var(--g) * 12)/calc(var(--g) * 13.5) "Silkscreen","Courier New",monospace;letter-spacing:calc(var(--g) * 0.6);--g:2px}
      #rbMc span{position:absolute;right:0;top:50%;transform:translateY(-50%);transform-origin:right center}`;
    document.head.appendChild(st);
    if (!document.getElementById("rbM-font")) { const l = document.createElement("link"); l.id = "rbM-font"; l.rel = "stylesheet"; l.href = "https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap"; document.head.appendChild(l); }
    const b = document.createElement("button"); b.id = "rbM"; b.type = "button";
    b.innerHTML = '<i class="sh"></i><i class="bd"></i><i class="in"></i><i class="tx">ENTER</i>';
    b.title = "Enter a promo code"; b.setAttribute("aria-label", "Enter a promo code");
    for (const t of ["mousedown", "mouseup", "touchstart", "touchend", "pointerdown", "pointerup"]) b.addEventListener(t, e => e.stopPropagation());
    b.onclick = e => { e.stopPropagation(); openRedeem(); };
    document.body.appendChild(b);
    /* the row label, written like the game's other labels */
    const cover = document.createElement("div"); cover.id = "rbMc";
    cover.innerHTML = "<span>PROMO<br>CODE</span>";   /* two lines, like DRIVE / DIRECTION */
    document.body.appendChild(cover);
    const probe = document.createElement("canvas"); probe.width = 160; probe.height = 90;
    const pc = probe.getContext("2d", { willReadFrequently: true });
    const isBlue = c => c[2] > 200 && c[0] < 90 && c[1] > 70 && c[1] < 140;
    const same = (a, c) => Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2]) < 24;
    const isWhite = c => c[0] > 230 && c[1] > 230 && c[2] > 230;
    const onOptions = cv => {
      try {
        pc.drawImage(cv, 0, 0, 160, 90);
        const px = (fx, fy) => pc.getImageData(Math.floor(fx * 160), Math.floor(fy * 90), 1, 1).data;
        return isWhite(px(0.95, 0.94)) && isWhite(px(0.95, 0.89)) && isWhite(px(0.88, 0.88))   // the white reddit box, bottom right
          && isBlue(px(0.10, 0.05)) && isBlue(px(0.50, 0.14)) && isBlue(px(0.62, 0.62))       // empty blue spaces
          && isBlue(px(0.88, 0.68));                                                            // the empty 4th row on the right
      } catch (e) { return false; }
    };
    setInterval(() => {
      const cv = document.getElementById("canvas");
      const show = !!cv && cv.width > 0 && !document.getElementById("rbA") && onOptions(cv);
      b.classList.toggle("on", show);
      cover.style.display = show ? "block" : "none";
      if (!show) return;
      const r = cv.getBoundingClientRect();
      /* Options screen: a PROMO CODE row in the empty 4th row on the right (under
         KICKRETURNS). The ENTER button has the same size and right edge as the buttons
         above it; the label is written right-aligned like the other labels. */
      const g = r.height / 270;   // one game pixel
      const ROW = 3 * 0.1478;     // three rows below ROSTER
      const left = r.left + r.width * 0.8226, right = r.left + r.width * 0.9735;
      const top = r.top + r.height * (0.1803 + ROW), bottom = r.top + r.height * (0.2979 + ROW);
      b.style.setProperty("--g", g + "px");
      Object.assign(b.style, { left: left + "px", top: top + "px", width: (right - left) + "px", height: (bottom - top) + "px" });
      const labelRight = r.left + r.width * 0.8119, labelLeft = r.left + r.width * 0.665;   // stops short of the DYNAMIC button
      cover.style.setProperty("--g", g + "px");
      Object.assign(cover.style, { left: labelLeft + "px", top: (r.top + r.height * (0.175 + ROW)) + "px",
        width: (left - labelLeft - g * 3) + "px", height: (r.height * 0.128) + "px" });
      /* the label sits flush with where ROSTER ended; shrink it if it would run into DYNAMIC */
      const span = cover.firstChild, room = labelRight - labelLeft;
      span.style.right = (left - g * 3 - labelRight) + "px";
      span.style.transform = "translateY(-50%)";
      const sw = span.getBoundingClientRect().width;
      if (sw > room) span.style.transform = `translateY(-50%) scale(${room / sw})`;
    }, 300);
  }
  if (document.readyState === "complete") menuPromo(); else window.addEventListener("load", menuPromo);

  /* ---------- Help ---------- */
  function renderHelp(body) {
    const bk = slot && backupOf(slot);
    body.innerHTML = `<div class="card"><h3>How to use this</h3>
        <p>1. Go to ${N.game}'s main menu or your team screen (not during a match).<br>
        2. Change things in the Team, Players or J. Stegall tabs.<br>
        3. Press "Save &amp; reload". The game restarts with your changes. Load your save as normal.</p>
        <p>Stats go from 1 to 10 because the game won't accept more. James Stegall's extra speed comes from the J. Stegall tab instead.</p></div>
      <div class="card"><h3>Backup</h3>
        <p>${bk ? `Your save from ${new Date(bk.at).toLocaleString()} is kept from just before your last change.` : "A backup is made automatically the first time you save from this panel."}</p>
        ${bk ? `<button class="b" data-restore>Restore backup</button>` : ""}</div>
      <div class="card"><h3>Safety</h3>
        <p>Players type promo codes in the PROMO tab on the left edge, or with Ctrl + 1 (or Ctrl + Alt + P). Make codes in the Promo codes tab. DISCORD.GG/LUNACY is built in.</p>
        <p>Open the panel with Ctrl + Alt + Q. After 5 wrong passcodes it locks for 1 minute, then longer each time. The panel locks itself after 15 minutes, or press Lock at the top.</p></div>`;
    const r = body.querySelector("[data-restore]");
    if (r) r.onclick = () => ask("Put back the backup? Your current save in this slot will be replaced.", "Restore", () => { $ls.set(slot, bk.data); msg("Backup restored. Reloading..."); setTimeout(() => location.reload(), 400); }, true);
  }

  /* ======================= the shortcut: Ctrl + Alt + Q ======================= */
  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && (e.code === "KeyQ" || e.key === "q" || e.key === "Q")) {
      e.preventDefault(); e.stopPropagation();
      if (root) return;
      if (unlocked && Date.now() - unlockedAt > AUTO_LOCK_MS) unlocked = false;
      if (unlocked) { unlockedAt = Date.now(); openPanel(false); } else askPass();
    }
    // Ctrl + 1 or Ctrl + Alt + P: the promo code box, for everyone
    if ((e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && (e.code === "Digit1" || e.code === "Numpad1")) ||
        (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && (e.code === "KeyP" || e.key === "p" || e.key === "P"))) {
      e.preventDefault(); e.stopPropagation();
      if (!root) openRedeem();
    }
  }, true);
  if (document.readyState === "complete") promoButton(); else window.addEventListener("load", () => setTimeout(promoButton, 500));
})();
