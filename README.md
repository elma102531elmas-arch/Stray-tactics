# Stray Tactical

Tarayıcıda çalışan, CS2 tarzı 1v1 FPS. Tek dosya: `stray-tactical.html` (Three.js r160, internet gerekir).

## Modlar
- **Bot düello** — kolay / normal / zor bot, ilk 5 kill kazanır.
- **Oda kur / katıl** — arkadaşınla P2P 1v1 (PeerJS).
- **DEV → Test alanı** — mankenler, hareketli hedefler, çelik plakalar, sprey duvarı, hasar sayıları, DPS.
- **DEV → Silah atölyesi** — Unity benzeri viewmodel silah editörü.

## Silah atölyesi (Stray Engine)
- Hiyerarşi (sürükle-bırak ile parent), Inspector (etikette sürükleyerek değer kaydırma), Proje paneli.
- Taşı / döndür / ölçekle gizmoları (W / E / R), lokal-global (X), snap (G), odakla (F).
- Şekiller: küp (yuvarlatılmış), silindir, koni, küre, kapsül, halka, **profil** (2D çiz + kalınlaştır, delik açılabilir), **torna** (profili döndür), boş grup, **.glb model içe aktarma**.
- Materyaller (silah metali, polimer, ahşap, karbon, cam, tritium…) ve CS2 tarzı desenler (fade, asiimov, kaplan, şam çeliği…).
- Roller: şarjör, sürgü, kurma kolu, tetik, horoz — animasyonlarda otomatik hareket eder.
- El tutuş noktaları (sağ/sol el), namlu ucu, kovan çıkışı.
- İstatistikler: hasar, RPM, şarjör, geri tepme, sprey deseni, dürbün, ses…
- **Oyun** sekmesi: ateş / şarjör / incele animasyonlarıyla canlı viewmodel önizlemesi.
- Geri al / yinele (Ctrl+Z / Ctrl+Y), kaydet (Ctrl+S), **Test Et** (Ctrl+P), JSON dışa / içe aktarma, envantere kuşan.

## Kontroller
`WASD` hareket · `Shift` yürü · `Ctrl`/`C` çömel · `Space` zıpla · `R` şarjör · `F` incele · `1-3` / tekerlek silah · `Q` son silah · sağ tık dürbün / bıçak saplama · `~` geliştirici konsolu (`help`).

Mobilde dokunmatik kontroller otomatik açılır.
