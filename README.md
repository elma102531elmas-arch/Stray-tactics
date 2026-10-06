# STRIKE POINT

Tarayıcıda çalışan taktik FPS: rekabetçi bomba imha modu, botlar, silah / harita / ses atölyeleri. Tek dosya: `stray-tactical.html` (Three.js r160, internet gerekir).

Oyunun adı ve alt başlığı **DEV → PROJE AYARLARI** bölümünden değiştirilebilir (varsayılan: *STRIKE POINT · TACTICAL SHOOTER*).

## Menüler
- **Üst menü çubuğu:** OYNA · ENVANTER · PROFİL · DEV, sağda rütbe / seviye ve ayarlar.
- **Ana ekran:** haritada duran ajan (alan derinliği efektiyle), hızlı oyun kartı, haberler, arkadaşlarla oyna, istatistikler, menü müziği.
- **Oyna:** Rekabetçi · Düello · Antrenman · Arkadaşla sekmeleri, gerçek 3D harita önizlemeleri, takım boyutu / taraf / maç uzunluğu / bot zorluğu.
- **Envanter:** birincil, tabanca, bıçak, ajan ve atölye silahları; 3D önizleme, nadirlik renkleri, istatistik çubukları, kuşan.
- **Profil:** rütbe (ACEMİ → EFSANE), XP, maç / galibiyet / K/D / kafa % / MVP ve son maçlar.
- **Ayarlar:** Oyun, Ses, Görüntü, Klavye / Fare (tuş atama), Nişangah (önizleme + paylaşılabilir kod), HUD.

## Modlar
- **Rekabetçi · bomba imha** — 1v1'den 5v5'e kadar botlarla T / AT maçı.
  - Donma süresi, raunt süresi, satın alma süresi.
  - Ekonomi: galibiyet ve mağlubiyet serisi primi, öldürme ödülü, bomba kurma primi.
  - C4 kurma / çözme (kit ile 5 sn), devre arasında taraf değişimi, kısa (16) ya da uzun (24) maç.
  - Radar, skor tablosu (TAB: para, L/A/Ö, kafa %, ort. hasar, MVP, skor), raunt sonu bandı ve raundun MVP'si, silah simgeli öldürme akışı.
  - Satın alma menüsü (B): numaralı kategoriler, `1-5` ile hızlı alım.
- **Bot düello** — ilk 5 / 10 / 15 leş kazanır.
- **Oda kur / katıl** — arkadaşınla P2P 1v1 (PeerJS).
- **Antrenman** — test alanı ya da haritalarda sınırsız mermiyle gezme.

## Ses
- Örnek dosya kullanmayan, tamamen kodla üretilen ses kütüphanesi: her silah için ateş, uzaktan ateş, çekme, şarjör çıkar / tak, mekanizma, boş tetik.
- **Her silah için 3 versiyon:** V1 Klasik · V2 Ağır · V3 Keskin — ateş, çekme ve şarjör için ayrı ayrı seçilir.
- Bombalar, C4 (tuş takımı, bip, çözme), isabet (kask / kafa / gövde / yelek), mermi vızıltısı, zemine göre ayak sesleri, kovanlar, arayüz sesleri, müzik (menü, raunt kazanma / kaybetme, son 10 saniye).
- Karıştırıcı kanalları: silahlar, efektler, spiker, müzik, arayüz; HRTF 3D konumlama, yankı, flaş sonrası kulak çınlaması.
- **Spiker:** "Bomb has been planted", "Bomb has been defused", "Terrorists win", "Counter-Terrorists win" ve bomba çağrıları — İngilizce / Türkçe tarayıcı sesiyle ya da kendi kayıtlarınla.

## Ses paketi
- Kendi bilgisayarındaki CS:GO / CS2 ses dosyalarını oyuna aktarabilirsin: **DEV → Ses atölyesi → Paket yükle** (ZIP ya da wav / mp3 / ogg / flac dosyaları), **Klasör** ya da dosyaları ses atölyesine sürükle-bırak. **Ayarlar → Ses → Ses paketi** bölümünden de yüklenir.
- Dosya adları otomatik eşlenir: `ak47_01.wav` → AK-47 ateş, `ak47_clipout.wav` → şarjör çıkarma, `usp_unsilenced_01.wav` → susturucusuz USP-S, `c4_beep1.wav` → C4 bipi, `knife_hit_01.wav` → bıçak isabeti … Eşleşmeyen dosyalar ses atölyesindeki **SES PAKETİ** sayfasında elle bir yuvaya atanabilir.
- Her silahın ateş / çekme / şarjör grubu için **PAKET** ve **PAKET 2** versiyonları V1-V2-V3'ün yanına eklenir; "Kendi dosyan" her zaman önce çalar, paket kapalıysa ya da pakette o ses yoksa kodla üretilen ses çalar. **Paketi kullan** ile tamamen kapatılabilir.
- Dosyalar **yalnızca senin tarayıcında** (IndexedDB) saklanır; hiçbir yere yüklenmez. **Paketi sil** hepsini kaldırır.
- Bu depo hiçbir oyun ses dosyası içermez.

## DEV
- İlk açılışta **proje kurulumu** soruları: oyunun adı, varsayılan silah ses versiyonu, spiker dili.
- **Silah atölyesi** — Unity benzeri viewmodel silah editörü (hiyerarşi, Inspector, profil çizici, materyaller, el tutuşları, istatistikler, ses profili ve versiyonları).
- **Harita atölyesi** — Unity benzeri seviye editörü.
- **Ses atölyesi** — her silah için ateş / çekme / şarjör seslerinde V1-V2-V3'ü dinle ve seç, ya da kendi ses dosyanı yükle; spiker anonslarını mikrofonla kaydet.
- **Test alanı** ve **konsol** (`~`).

## Haritalar
- **Kum Vadisi** — çöl kasabası bomba haritası: uzun A, kısa A (yükseltilmiş geçit), orta kapılar, kapalı B tünelleri.
- **Avlu** — simetrik, küçük bir arena.
- Atölyede yaptığın haritalar **★** ile listelenir.

## Silahlar
- **Tabancalar:** Glock-18, USP-S, P250, Tec-9, Desert Eagle
- **SMG ve pompalı:** MAC-10, MP9, P90, Nova
- **Tüfekler:** Galil AR, FAMAS, AK-47, M4A4, M4A1-S, AUG (1,7× dürbün), SSG 08, AWP
- **Bombalar:** HE, flaş, sis, molotof, yangın bombası, dekoy — sis görüşü keser, molotofu söndürür; dekoy 15 sn boyunca senin silahının sesiyle sahte ateş eder ve rakip radarında görünür.
- **Susturucu:** USP-S ve M4A1-S'de sağ tık (mobilde SUS.) susturucuyu takar / söker.
- **Ekipman:** C4, kevlar, kask, imha kiti

## Harita atölyesi
- **Paneller:** Sahne hiyerarşisi, Inspector, nesne paleti (sürükle-bırak ya da tıkla) ve harita kütüphanesi (üstten küçük resimlerle).
- **Gizmolar:** taşı / döndür / boyut (W / E / R), 0,5 m snap (G), üstten görünüm (T), odakla (F), ok tuşlarıyla kaydırma.
- **Yapı nesneleri:** blok / duvar, zemin, rampa, merdiven, kemerli geçit, sütun, konteyner.
- **Dekor:** sandık, varil, kum torbası, kapı, tente, lamba, palmiye, tabela, kablo, .glb model.
- **Oyun nesneleri:** T / AT doğuş noktaları, A / B bomba alanları.
- **Harita ayarları:** boyut, zemin, güneş yönü ve yüksekliği, sis, uzak şehir silueti.
- **Gez** (Ctrl+P) ile haritada dolaş, **Bot maçı** ile hemen bomba maçı at; ESC → atölyeye dön.
- Botların yol ağı her harita için otomatik çıkarılır.
- Geri al / yinele, kaydet, JSON dışa / içe aktarma, şablon haritaları kopyalayıp düzenleme.

## Kontroller
Tüm tuşlar **Ayarlar → Klavye / Fare** bölümünden değiştirilebilir. Varsayılanlar:
- **Hareket:** `WASD` · `Shift` yürü · `Ctrl` / `C` çömel · `Space` zıpla
- **Silah:** `R` şarjör · `F` incele · `1-5` / tekerlek silah · `Q` son silah · `G` silahı / bombayı at · sağ tık dürbün, bıçak saplama ya da alttan bomba atışı
- **Bomba modu:** `B` satın al · `E` bomba kur / çöz / silah al · `TAB` skor tablosu
- `~` geliştirici konsolu (`help`; örn. `map kumvadisi`, `bot_add`, `mp_roundtime`, `cash`)

Mobilde dokunmatik kontroller otomatik açılır (E ve $ düğmeleri dahil).

## Not
Bu bağımsız bir hayran projesidir; Valve ya da Counter-Strike ile bir bağlantısı yoktur ve onlara ait isim, logo, harita veya ses dosyası içermez. Oyunla gelen tüm sesler kodla üretilir; ses paketi özelliği yalnızca oyuncunun kendi cihazından seçtiği dosyaları tarayıcıda kullanır.
