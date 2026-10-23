# Saint Marrow

A first-person horror game for phones and computers. Play alone or with up to 3 friends online.
Five chapters set in an abandoned sanatorium that closed in 1994: you have a flashlight, a crowbar,
and later a pistol and a hunting rifle with very little ammo. Injuries work like real ones:
bleeding needs a bandage, and a broken leg makes you limp until you use a medkit. You can hide in lockers.

13+: blood, injuries and frightening scenes (blood can be set to Low or Off in Settings).

## Play

Open `index.html` from a web server, for example GitHub Pages:
Settings → Pages → deploy from the `main` branch, then open
`https://<your-user>.github.io/<repo>/saint-marrow/`.
Opening the file directly from disk does not work, because browsers block game modules on `file://`.

**Co-op:** one player taps *Play with friends → Host a game* and shares the 5-letter code;
friends enter it under *Join a game*. Connections go player-to-player through PeerJS.

**Touch:** left thumb moves (push all the way up to sprint), right thumb looks, tap the right side to use things.
**Keyboard:** WASD, mouse, Shift sprint, C crouch, F flashlight, E use, R reload, Q switch weapon, H heal, Tab journal.

## Credits

- Textures and 3D props: [Poly Haven](https://polyhaven.com) (CC0)
- Rendering: [three.js](https://threejs.org) r170 (MIT), networking: [PeerJS](https://peerjs.com) (MIT)
- Monsters, hands, sounds and levels are generated in code.

---

# Saint Marrow (Türkçe)

Telefon ve bilgisayar için birinci şahıs korku oyunu. Tek başına ya da en fazla 3 arkadaşınla çevrimiçi oynanır.
1994'te kapanan terk edilmiş bir sanatoryumda geçen 5 bölüm. Fenerin ve levyen var; sonra çok az mermiyle
tabanca ve av tüfeği buluyorsun. Yaralar gerçekçi: kanamayı bandajla durdurman gerekir, kırık bacak
ilk yardım çantası kullanana kadar topallatır. Dolaplara saklanabilirsin.

**Oynamak için:** `index.html` dosyasını bir web sunucusundan aç (örneğin GitHub Pages:
Settings → Pages → `main` dalından yayınla, sonra `https://<kullanıcı>.github.io/<repo>/saint-marrow/` adresine git).
**Arkadaşlarla:** biri *Arkadaşlarla oyna → Oda kur* der ve 5 harfli kodu paylaşır; diğerleri *Odaya katıl* ile kodu girer.
