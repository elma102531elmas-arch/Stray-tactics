# Saint Marrow

A first-person psychological horror game for phones and computers. Play alone or with up to 4 friends online (1–5 players).

You come through the woods at night with nothing but a torch. Something tall stands between the trees and watches; walk
toward it, stare at it or put the light on it and it is gone. Past the security booth and the generator, the gate of
the old hospital opens — and closes behind you. Inside there is very little ammunition, below there is something that
patrols, and at the end the place has to burn.

| Chapter | | |
|---|---|---|
| 1 | The Woods | the path, the camp, the hunter's cabin, the lookout, the security booth, the gate. No weapon. |
| 2 | Inside | entrance, security office (the first pistol, very little ammo), wards, the fuse box. |
| 3 | Below | service floor, morgue, tunnels and archive. Stealth: crouch, hide, throw a bottle to pull the patrol away. |
| 4 | The Hidden Wing — *draft* | placeholder level, not part of the approved story yet. |
| 5 | The System — *draft* | placeholder level, not part of the approved story yet. |
| 6 | Burn the Memory | three control stations, the core, the alarm and a timed escape — then out through the burning woods. |

Chapters 4 and 5 are marked **draft** in the game until the story for them is decided.

Injuries work like real ones: bleeding needs a bandage, and a broken leg makes you limp until you use a medkit.
You can hide in lockers. 13+: blood, injuries and frightening scenes (blood can be set to Low or Off in Settings).

## Play

* **One file:** open `saint-marrow.html` (in the repository root) straight from disk — everything is inside it.
* **From the source:** serve the repository (for example `node studio/serve.mjs`, or GitHub Pages) and open `/saint-marrow/`.
  Opening `index.html` directly from disk does not work, because browsers block game modules on `file://`.

**Co-op:** one player taps *Play with friends → Host a game* and shares the 5-letter code;
friends enter it under *Join a game*. Connections go player-to-player through PeerJS.

**Touch:** left thumb moves (push all the way up to sprint), right thumb looks, tap the right side to use things.
**Keyboard:** WASD, mouse, Shift sprint, C crouch, F torch, E use (some things take a moment: press once and keep looking at them), R reload, Q switch weapon,
X throw a bottle, H heal, Tab journal, F9 show enemy hitboxes.

## For developers

* After changing the game, rebuild the single file: `node studio/tools/build-game-single.mjs` (needs esbuild, dev only).
* Every chapter is played through with real key presses by `studio/tests/browser/game-*.test.mjs`
  (`node studio/tests/run.mjs browser game`).
* Known problems: the woods (chapter 1 and the epilogue) draw ~1600 trees and are the heaviest scenes — fine on a
  graphics card, slow on software rendering. Hitboxes are fitted to each creature's mesh (head, torso, limbs); F9 shows them.

## Credits

- Textures and 3D props: [Poly Haven](https://polyhaven.com) (CC0)
- Rendering: [three.js](https://threejs.org) r170 (MIT), networking: [PeerJS](https://peerjs.com) (MIT)
- Monsters, hands, sounds and levels are generated in code.

---

# Saint Marrow (Türkçe)

Telefon ve bilgisayar için birinci şahıs psikolojik korku oyunu. Tek başına ya da en fazla 4 arkadaşınla (1–5 oyuncu) çevrimiçi oynanır.

Gece, elinde sadece bir fenerle ormandan geçiyorsun. Ağaçların arasında uzun bir şey durup seni izliyor; ona doğru
yürürsen, uzun süre bakarsan ya da ışığı üstüne tutarsan kayboluyor. Güvenlik kulübesi ve jeneratörden sonra eski
hastanenin kapısı açılıyor — ve arkandan kapanıyor.

1. **Orman** — patika, kamp, avcı kulübesi, gözetleme noktası, güvenlik kulübesi, kapı. Silah yok.
2. **İçeride** — giriş, güvenlik bölümü (ilk tabanca, çok az mermi), koğuşlar, sigorta kutusu.
3. **Alt Katlar** — servis katı, morg, tüneller, arşiv. Gizlilik: çömel, saklan, devriyeyi uzaklaştırmak için şişe fırlat.
4. **Gizli Bölüm** ve 5. **Sistem** — **taslak**, henüz onaylı hikâyenin parçası değil (oyunda böyle işaretli).
6. **Hafızayı Yak** — üç kontrol istasyonu, çekirdek, alarm ve süreli kaçış; sonra yanan ormandan çıkış.

**Oynamak için:** depo kökündeki `saint-marrow.html` dosyasını doğrudan aç (her şey içinde), ya da depoyu bir sunucudan
yayınlayıp `/saint-marrow/` adresine git.
**Arkadaşlarla:** biri *Arkadaşlarla oyna → Oda kur* der ve 5 harfli kodu paylaşır; diğerleri *Odaya katıl* ile kodu girer.
**Klavye:** WASD, fare, Shift koş, C çömel, F fener, E kullan (bazı şeyler biraz sürer: bir kez bas ve bakmaya devam et), R şarjör, Q silah değiştir,
X şişe fırlat, H iyileş, Tab günlük.
