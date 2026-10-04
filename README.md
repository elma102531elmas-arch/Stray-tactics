# Stray Tactical

Tarayıcıda çalışan taktik FPS: rekabetçi bomba imha modu, botlar, silah ve harita atölyeleri. Tek dosya: `stray-tactical.html` (Three.js r160, internet gerekir).

## Modlar
- **Rekabetçi · bomba imha** — 1v1'den 5v5'e kadar botlarla T / AT maçı.
  - Donma süresi, raunt süresi, satın alma süresi.
  - Ekonomi: galibiyet ve mağlubiyet serisi primi, öldürme ödülü, bomba kurma primi.
  - C4 kurma / çözme (kit ile 5 sn), devre arasında taraf değişimi, kısa (16) ya da uzun (24) maç.
  - Radar, skor tablosu (TAB), satın alma menüsü (B), düşen silahlar, öldükten sonra takım arkadaşını izleme.
- **Bot düello** — ilk 5 kill kazanır.
- **Oda kur / katıl** — arkadaşınla P2P 1v1 (PeerJS).
- **DEV → Test alanı** — mankenler, hareketli hedefler, çelik plakalar, sprey duvarı, hasar sayıları, DPS.
- **DEV → Silah atölyesi** — Unity benzeri viewmodel silah editörü.
- **DEV → Harita atölyesi** — Unity benzeri seviye editörü.

## Haritalar
- **Kum Vadisi** — çöl kasabası bomba haritası: uzun A, kısa A (yükseltilmiş geçit), orta kapılar, kapalı B tünelleri.
- **Avlu** — simetrik, küçük bir arena.
- Atölyede yaptığın haritalar **★** ile listelenir.

## Silahlar
- **Tabancalar:** Glock-18, USP-S, P250, Desert Eagle
- **SMG ve pompalı:** MAC-10, MP9, Nova
- **Tüfekler:** Galil AR, FAMAS, AK-47, M4A4, M4A1-S, SSG 08, AWP
- **Bombalar:** HE, flaş, sis, molotof, yangın bombası — sis görüşü keser, molotofu söndürür.
- **Ekipman:** C4, kevlar, kask, imha kiti

## Harita atölyesi (Stray Engine)
- **Paneller:** Sahne hiyerarşisi, Inspector, nesne paleti (sürükle-bırak ya da tıkla) ve harita kütüphanesi (üstten küçük resimlerle).
- **Gizmolar:** taşı / döndür / boyut (W / E / R), 0,5 m snap (G), üstten görünüm (T), odakla (F), ok tuşlarıyla kaydırma.
- **Yapı nesneleri:** blok / duvar, zemin, rampa, merdiven, kemerli geçit, sütun, konteyner.
- **Dekor:** sandık, varil, kum torbası, kapı, tente, lamba, palmiye, tabela, kablo, .glb model.
- **Oyun nesneleri:** T / AT doğuş noktaları, A / B bomba alanları.
- **Harita ayarları:** boyut, zemin, güneş yönü ve yüksekliği, sis, uzak şehir silueti.
- **Gez** (Ctrl+P) ile haritada dolaş, **Bot maçı** ile hemen bomba maçı at; ESC → atölyeye dön.
- Botların yol ağı her harita için otomatik çıkarılır.
- Geri al / yinele, kaydet, JSON dışa / içe aktarma, şablon haritaları kopyalayıp düzenleme.

## Silah atölyesi
- Hiyerarşi, Inspector, profil (2D çiz + kalınlaştır) ve torna parçaları, .glb içe aktarma.
- Materyaller, desenler, el tutuş noktaları, animasyon rolleri.
- İstatistikler: fiyat, takım ve öldürme ödülü dahil.
- El bombası ve C4 türleri, oyun görünümünde canlı önizleme, test alanında dene.

## Kontroller
- **Hareket:** `WASD` · `Shift` yürü · `Ctrl` / `C` çömel · `Space` zıpla
- **Silah:** `R` şarjör · `F` incele · `1-5` / tekerlek silah · `Q` son silah · `G` silahı / bombayı at · sağ tık dürbün, bıçak saplama ya da alttan bomba atışı
- **Bomba modu:** `B` satın al · `E` bomba kur / çöz / silah al · `TAB` skor tablosu
- `~` geliştirici konsolu (`help`; örn. `map kumvadisi`, `bot_add`, `mp_roundtime`, `cash`)

Mobilde dokunmatik kontroller otomatik açılır (E ve $ düğmeleri dahil).
