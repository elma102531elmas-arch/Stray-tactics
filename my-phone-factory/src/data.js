/* =========================================================
   STATIC GAME DATA
   ========================================================= */
const D = {};

/* ---------- Countries (HQ) ---------- */
D.countries = [
  { id: 'us', name: 'United States', flag: '🇺🇸', region: 'na', wage: 1.0, tax: 0.25, investor: 1.35, supply: 1.05, rent: 1.0, talent: 1.2, desc: 'Deep venture capital and a rich home market, but talent and rent are brutally expensive.' },
  { id: 'cn', name: 'China', flag: '🇨🇳', region: 'cn', wage: 0.32, tax: 0.25, investor: 1.1, supply: 0.92, rent: 0.45, talent: 1.0, desc: 'Next to the world\'s electronics supply chain. Cheap components, fierce domestic competition.' },
  { id: 'tw', name: 'Taiwan', flag: '🇹🇼', region: 'eas', wage: 0.45, tax: 0.2, investor: 0.9, supply: 0.95, rent: 0.55, talent: 1.1, desc: 'Semiconductor heartland. Great silicon talent, small home market.' },
  { id: 'kr', name: 'South Korea', flag: '🇰🇷', region: 'eas', wage: 0.6, tax: 0.24, investor: 0.9, supply: 0.96, rent: 0.65, talent: 1.1, desc: 'Display and memory giants nearby. Demanding, tech-savvy consumers.' },
  { id: 'jp', name: 'Japan', flag: '🇯🇵', region: 'eas', wage: 0.7, tax: 0.3, investor: 0.85, supply: 0.98, rent: 0.8, talent: 1.05, desc: 'Excellent camera-sensor and materials expertise. Conservative investors.' },
  { id: 'in', name: 'India', flag: '🇮🇳', region: 'in', wage: 0.18, tax: 0.3, investor: 0.75, supply: 1.0, rent: 0.3, talent: 0.95, desc: 'Very low costs and an exploding budget market — where margins are razor thin.' },
  { id: 'de', name: 'Germany', flag: '🇩🇪', region: 'eu', wage: 0.85, tax: 0.3, investor: 1.0, supply: 1.04, rent: 0.75, talent: 1.05, desc: 'Engineering culture and strong manufacturing, high labour costs.' },
  { id: 'gb', name: 'United Kingdom', flag: '🇬🇧', region: 'eu', wage: 0.8, tax: 0.22, investor: 1.1, supply: 1.04, rent: 0.9, talent: 1.0, desc: 'Strong chip-architecture heritage and access to European capital.' },
  { id: 'fi', name: 'Finland', flag: '🇫🇮', region: 'eu', wage: 0.75, tax: 0.24, investor: 0.95, supply: 1.04, rent: 0.6, talent: 1.1, desc: 'A legendary mobile-phone engineering talent pool looking for a new home.' },
  { id: 'tr', name: 'Turkey', flag: '🇹🇷', region: 'eu', wage: 0.3, tax: 0.22, investor: 0.6, supply: 1.03, rent: 0.35, talent: 0.88, desc: 'Low costs and a bridge between Europe and the Middle East. Capital is hard to raise.' },
  { id: 'br', name: 'Brazil', flag: '🇧🇷', region: 'latam', wage: 0.3, tax: 0.34, investor: 0.6, supply: 1.12, rent: 0.4, talent: 0.8, desc: 'Huge protected market, heavy import tariffs and taxes.' },
  { id: 'vn', name: 'Vietnam', flag: '🇻🇳', region: 'sea', wage: 0.15, tax: 0.2, investor: 0.55, supply: 0.95, rent: 0.25, talent: 0.8, desc: 'The cheapest assembly labour, a growing market, few investors.' },
  { id: 'ae', name: 'UAE', flag: '🇦🇪', region: 'mea', wage: 0.7, tax: 0.0, investor: 0.95, supply: 1.02, rent: 0.85, talent: 0.85, desc: 'No corporate tax and sovereign funds, but almost no local tech talent.' },
];
D.country = (id) => D.countries.find((c) => c.id === id);

/* ---------- Regions & market ---------- */
D.regions = {
  na: { name: 'North America', s0: 0.2, s1: 0.11, sens: 0.8, mix: [0.22, 0.3, 0.2, 0.28], entry: 60000, ad: 1.4 },
  eu: { name: 'Europe', s0: 0.22, s1: 0.14, sens: 1.0, mix: [0.33, 0.33, 0.18, 0.16], entry: 50000, ad: 1.1 },
  cn: { name: 'China', s0: 0.15, s1: 0.22, sens: 1.1, mix: [0.4, 0.33, 0.15, 0.12], entry: 40000, ad: 0.8 },
  in: { name: 'India', s0: 0.03, s1: 0.12, sens: 1.8, mix: [0.72, 0.22, 0.04, 0.02], entry: 25000, ad: 0.35 },
  eas: { name: 'Japan · Korea · Taiwan', s0: 0.1, s1: 0.05, sens: 0.85, mix: [0.2, 0.3, 0.22, 0.28], entry: 45000, ad: 1.2 },
  sea: { name: 'SE Asia & Oceania', s0: 0.08, s1: 0.11, sens: 1.4, mix: [0.55, 0.3, 0.1, 0.05], entry: 20000, ad: 0.45 },
  latam: { name: 'Latin America', s0: 0.1, s1: 0.11, sens: 1.4, mix: [0.6, 0.28, 0.08, 0.04], entry: 30000, ad: 0.5 },
  mea: { name: 'Middle East & Africa', s0: 0.12, s1: 0.14, sens: 1.5, mix: [0.62, 0.26, 0.08, 0.04], entry: 20000, ad: 0.4 },
};
D.regionIds = Object.keys(D.regions);
D.segments = [
  { id: 'budget', name: 'Budget', exp: 44, elast: 2.6, ref: 140 },
  { id: 'mid', name: 'Mid-range', exp: 60, elast: 2.1, ref: 280 },
  { id: 'premium', name: 'Premium', exp: 75, elast: 1.6, ref: 480 },
  { id: 'flagship', name: 'Flagship', exp: 88, elast: 1.15, ref: 720 },
];
// Price-band upper limits in 2010 dollars (inflated over time)
D.bandLimits = [180, 380, 580];
D.inflation = (fy) => Math.pow(1.025, fy - 2010);
D.globalUnits = { 2010: 300, 2011: 470, 2012: 680, 2013: 970, 2014: 1280, 2015: 1430, 2016: 1470, 2017: 1465, 2018: 1405, 2019: 1370, 2020: 1290, 2021: 1350, 2022: 1210, 2023: 1165, 2024: 1220, 2025: 1240 };
D.unitsPerYear = (y) => (D.globalUnits[y] || 1240 * Math.pow(1.01, y - 2025)) * 1e6;
D.season = [0.86, 0.84, 0.95, 0.94, 0.96, 0.95, 0.97, 0.98, 1.08, 1.05, 1.17, 1.25];

/* ---------- Semiconductor process nodes ---------- */
D.nodes = [
  { id: 'n90', nm: '90nm', year: 2004, dens: 1.6, wafer: 1300, fNom: 0.8, E: 6.0, mask: 0.6e6, fab: 0.5e9, tech: 'fab90' },
  { id: 'n65', nm: '65nm', year: 2006.5, dens: 2.6, wafer: 1700, fNom: 1.0, E: 4.3, mask: 1.0e6, fab: 0.9e9, tech: 'fab65' },
  { id: 'n45', nm: '45nm', year: 2009, dens: 4.6, wafer: 2300, fNom: 1.2, E: 3.0, mask: 1.6e6, fab: 1.6e9, tech: 'fab45' },
  { id: 'n28', nm: '28nm', year: 2012, dens: 12, wafer: 3000, fNom: 1.9, E: 1.8, mask: 3e6, fab: 3.5e9, tech: 'fab28' },
  { id: 'n14', nm: '14nm', year: 2015, dens: 28, wafer: 5000, fNom: 2.3, E: 1.0, mask: 8e6, fab: 7e9, tech: 'fab14' },
  { id: 'n10', nm: '10nm', year: 2017, dens: 50, wafer: 6500, fNom: 2.5, E: 0.82, mask: 15e6, fab: 9e9, tech: 'fab10' },
  { id: 'n7', nm: '7nm', year: 2018.6, dens: 91, wafer: 9300, fNom: 2.8, E: 0.66, mask: 30e6, fab: 12e9, tech: 'fab7' },
  { id: 'n5', nm: '5nm', year: 2020.7, dens: 138, wafer: 16000, fNom: 3.1, E: 0.52, mask: 45e6, fab: 18e9, tech: 'fab5' },
  { id: 'n3', nm: '3nm', year: 2023.7, dens: 197, wafer: 20000, fNom: 3.5, E: 0.43, mask: 65e6, fab: 22e9, tech: 'fab3' },
  { id: 'n2', nm: '2nm', year: 2025.8, dens: 270, wafer: 28000, fNom: 3.9, E: 0.37, mask: 90e6, fab: 28e9, tech: 'fab2' },
  { id: 'n14a', nm: '1.4nm', year: 2028.5, dens: 360, wafer: 36000, fNom: 4.2, E: 0.32, mask: 120e6, fab: 35e9, tech: 'fab14a' },
  { id: 'n1', nm: '1nm', year: 2031.5, dens: 470, wafer: 45000, fNom: 4.5, E: 0.28, mask: 160e6, fab: 45e9, tech: 'fab1' },
];
D.node = (id) => D.nodes.find((n) => n.id === id);
D.foundries = [
  { id: 'formosa', name: 'Formosa Silicon', lead: 0, price: 1.0, desc: 'Technology leader. Newest nodes first, premium prices.' },
  { id: 'pacific', name: 'Pacific Foundry', lead: 0.8, price: 0.88, desc: 'Second source, cheaper, ~1 year behind on new nodes.' },
  { id: 'meridian', name: 'Meridian Semi', lead: 2.5, price: 0.72, desc: 'Mature nodes only, very cheap, short queues.' },
];

/* ---------- Chip IP generations ---------- */
D.cpuGens = [
  { g: 1, year: 2009, ipc: 1.0, P: 0.2, T: 22, name: 'Gen 1 · dual-issue in-order', maxBig: 2 },
  { g: 2, year: 2011, ipc: 1.3, P: 0.3, T: 30, name: 'Gen 2 · out-of-order', maxBig: 4 },
  { g: 3, year: 2013, ipc: 1.65, P: 0.5, T: 48, name: 'Gen 3 · wide OoO + big.LITTLE', maxBig: 4 },
  { g: 4, year: 2015, ipc: 2.0, P: 0.6, T: 70, name: 'Gen 4 · 64-bit', maxBig: 4 },
  { g: 5, year: 2018, ipc: 2.8, P: 0.7, T: 110, name: 'Gen 5 · 4-wide 64-bit', maxBig: 4 },
  { g: 6, year: 2020, ipc: 3.4, P: 1.0, T: 180, name: 'Gen 6 · prime cores', maxBig: 4 },
  { g: 7, year: 2022, ipc: 4.0, P: 1.2, T: 240, name: 'Gen 7 · 8-wide', maxBig: 8 },
  { g: 8, year: 2024, ipc: 4.7, P: 1.4, T: 300, name: 'Gen 8 · 10-wide', maxBig: 8 },
  { g: 9, year: 2027, ipc: 5.4, P: 1.6, T: 380, name: 'Gen 9 · AI-scheduled', maxBig: 8 },
  { g: 10, year: 2030, ipc: 6.2, P: 1.8, T: 460, name: 'Gen 10 · neuromorphic assist', maxBig: 10 },
];
D.gpuGens = [
  { g: 1, year: 2010, fl: 8, P: 0.12, T: 18 }, { g: 2, year: 2012, fl: 16, P: 0.18, T: 26 }, { g: 3, year: 2014, fl: 32, P: 0.3, T: 40 },
  { g: 4, year: 2016, fl: 64, P: 0.45, T: 60 }, { g: 5, year: 2018, fl: 96, P: 0.6, T: 80 }, { g: 6, year: 2020, fl: 128, P: 0.75, T: 110 },
  { g: 7, year: 2022, fl: 192, P: 0.9, T: 150, rt: true }, { g: 8, year: 2024, fl: 256, P: 1.0, T: 190, rt: true },
  { g: 9, year: 2027, fl: 340, P: 1.1, T: 230, rt: true }, { g: 10, year: 2030, fl: 440, P: 1.2, T: 280, rt: true },
];
D.npuGens = [
  { g: 0, year: 0, tops: 0, T: 0 }, { g: 1, year: 2017, tops: 0.6, T: 120 }, { g: 2, year: 2018, tops: 1.5, T: 150 }, { g: 3, year: 2019, tops: 3, T: 180 },
  { g: 4, year: 2020, tops: 6, T: 220 }, { g: 5, year: 2022, tops: 12, T: 260 }, { g: 6, year: 2024, tops: 22, T: 300 },
  { g: 7, year: 2026, tops: 40, T: 350 }, { g: 8, year: 2029, tops: 75, T: 420 },
];
D.ispGens = [
  { g: 1, year: 2009, maxMP: 8, video: '720p30', q: 0.55, T: 40 }, { g: 2, year: 2012, maxMP: 16, video: '1080p30', q: 0.65, T: 90 },
  { g: 3, year: 2014, maxMP: 24, video: '4K30', q: 0.75, T: 130 }, { g: 4, year: 2017, maxMP: 48, video: '4K60', q: 0.84, T: 180 },
  { g: 5, year: 2019, maxMP: 108, video: '8K24', q: 0.92, T: 240 }, { g: 6, year: 2021, maxMP: 200, video: '8K30', q: 1.0, T: 300 },
  { g: 7, year: 2024, maxMP: 200, video: '8K60 AI', q: 1.08, T: 360 }, { g: 8, year: 2028, maxMP: 320, video: '12K', q: 1.16, T: 440 },
];
D.modems = [
  { g: 0, name: 'No modem (Wi-Fi only)', year: 0, mbps: 0, P: 0, T: 0, cost: 0 },
  { g: 1, name: '3G HSPA+', year: 2009, mbps: 21, P: 0.38, T: 60, cost: 14 },
  { g: 2, name: '4G LTE', year: 2011, mbps: 100, P: 0.45, T: 90, cost: 22 },
  { g: 3, name: 'LTE-Advanced', year: 2014, mbps: 300, P: 0.42, T: 120, cost: 20 },
  { g: 4, name: 'Gigabit LTE', year: 2016, mbps: 1000, P: 0.4, T: 150, cost: 22 },
  { g: 5, name: '5G Sub-6', year: 2019.3, mbps: 2500, P: 0.55, T: 220, cost: 35 },
  { g: 6, name: '5G mmWave', year: 2020.5, mbps: 5000, P: 0.52, T: 280, cost: 42 },
  { g: 7, name: '5G-Advanced', year: 2025, mbps: 10000, P: 0.46, T: 330, cost: 40 },
  { g: 8, name: '6G', year: 2030, mbps: 50000, P: 0.5, T: 400, cost: 60 },
];

/* ---------- Memory & storage ---------- */
D.ram = [
  { id: 'lpddr1', name: 'LPDDR1', year: 2008, mts: 400, pj: 22, lat: 70, maxGB: 1, tech: null, lp: true },
  { id: 'ddr3', name: 'DDR3 (std)', year: 2010, mts: 1333, pj: 34, lat: 55, maxGB: 2, tech: null, lp: false },
  { id: 'lpddr2', name: 'LPDDR2', year: 2011, mts: 1066, pj: 15, lat: 60, maxGB: 2, tech: 'ram_lp2', lp: true },
  { id: 'lpddr3', name: 'LPDDR3', year: 2013, mts: 1866, pj: 11, lat: 55, maxGB: 4, tech: 'ram_lp3', lp: true },
  { id: 'ddr4', name: 'DDR4 (std)', year: 2015, mts: 2400, pj: 20, lat: 50, maxGB: 8, tech: 'ram_ddr4', lp: false },
  { id: 'lpddr4', name: 'LPDDR4', year: 2015, mts: 3200, pj: 7, lat: 50, maxGB: 8, tech: 'ram_lp4', lp: true },
  { id: 'lpddr4x', name: 'LPDDR4X', year: 2017, mts: 4266, pj: 5, lat: 48, maxGB: 12, tech: 'ram_lp4x', lp: true },
  { id: 'lpddr5', name: 'LPDDR5', year: 2020, mts: 6400, pj: 4, lat: 45, maxGB: 16, tech: 'ram_lp5', lp: true },
  { id: 'ddr5', name: 'DDR5 (std)', year: 2021, mts: 4800, pj: 9, lat: 46, maxGB: 24, tech: 'ram_ddr5', lp: false },
  { id: 'lpddr5x', name: 'LPDDR5X', year: 2022, mts: 8533, pj: 3.3, lat: 43, maxGB: 24, tech: 'ram_lp5x', lp: true },
  { id: 'lpddr6', name: 'LPDDR6', year: 2026, mts: 10667, pj: 2.7, lat: 40, maxGB: 32, tech: 'ram_lp6', lp: true },
  { id: 'lpddr6x', name: 'LPDDR6X', year: 2029, mts: 14400, pj: 2.2, lat: 38, maxGB: 48, tech: 'ram_lp6x', lp: true },
  { id: 'lpddr7', name: 'LPDDR7', year: 2032, mts: 19200, pj: 1.8, lat: 36, maxGB: 64, tech: 'ram_lp7', lp: true },
];
D.ramT = (id) => D.ram.find((r) => r.id === id);
D.ramSizes = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
D.storage = [
  { id: 'emmc44', name: 'eMMC 4.4', year: 2010, read: 90, tech: null, prem: 1 },
  { id: 'emmc45', name: 'eMMC 4.5', year: 2012, read: 140, tech: null, prem: 1 },
  { id: 'emmc51', name: 'eMMC 5.1', year: 2015, read: 250, tech: null, prem: 1 },
  { id: 'ufs2', name: 'UFS 2.1', year: 2016, read: 800, tech: 'sto_ufs2', prem: 1.25 },
  { id: 'ufs3', name: 'UFS 3.1', year: 2019, read: 1900, tech: 'sto_ufs3', prem: 1.3 },
  { id: 'ufs4', name: 'UFS 4.0', year: 2022, read: 4200, tech: 'sto_ufs4', prem: 1.35 },
  { id: 'ufs5', name: 'UFS 5.0', year: 2027, read: 10000, tech: 'sto_ufs5', prem: 1.4 },
];
D.stoT = (id) => D.storage.find((r) => r.id === id);
D.stoSizes = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];

/* ---------- Display ---------- */
D.dispTypes = [
  { id: 'tn', name: 'TN LCD', year: 2005, q: 0.45, pw: 0.078, cost: 1.4, tech: null, nits: 350 },
  { id: 'ips', name: 'IPS LCD', year: 2010, q: 0.62, pw: 0.068, cost: 1.7, tech: 'disp_ips', nits: 550 },
  { id: 'amoled', name: 'AMOLED', year: 2010, q: 0.74, pw: 0.056, cost: 3.2, tech: 'disp_amoled', nits: 450 },
  { id: 'amoled2', name: 'Dynamic AMOLED', year: 2016, q: 0.86, pw: 0.046, cost: 3.6, tech: 'disp_amoled2', nits: 1000 },
  { id: 'ltpo', name: 'LTPO OLED', year: 2021, q: 0.95, pw: 0.036, cost: 4.2, tech: 'disp_ltpo', nits: 2000 },
  { id: 'micro', name: 'MicroLED', year: 2030, q: 1.06, pw: 0.024, cost: 8, tech: 'disp_micro', nits: 4000 },
];
D.dispT = (id) => D.dispTypes.find((r) => r.id === id);
D.resolutions = [
  { id: 'hvga', name: 'HVGA', w: 320, year: 2007, tech: null },
  { id: 'wvga', name: 'WVGA', w: 480, year: 2009, tech: null },
  { id: 'qhd540', name: 'qHD', w: 540, year: 2011, tech: null },
  { id: 'hd', name: 'HD 720p', w: 720, year: 2012, tech: 'disp_hd' },
  { id: 'fhd', name: 'Full HD', w: 1080, year: 2013, tech: 'disp_fhd' },
  { id: 'qhd', name: 'Quad HD', w: 1440, year: 2014, tech: 'disp_qhd' },
  { id: 'uhd', name: '4K', w: 2160, year: 2016, tech: 'disp_4k' },
];
D.resT = (id) => D.resolutions.find((r) => r.id === id);
D.refresh = [
  { hz: 60, tech: null }, { hz: 90, tech: 'disp_90' }, { hz: 120, tech: 'disp_120' }, { hz: 144, tech: 'disp_144' }, { hz: 165, tech: 'disp_165' },
];
D.bezels = [
  { id: 'b169', name: 'Classic 16:9 (thick bezels)', aspect: 16 / 9, stb: 0.6, tech: null },
  { id: 'b189', name: '18:9 Full-View', aspect: 2.0, stb: 0.76, tech: 'bezel_18' },
  { id: 'notch', name: 'Notch 19.5:9', aspect: 19.5 / 9, stb: 0.82, tech: 'bezel_notch' },
  { id: 'punch', name: 'Punch-hole 20:9', aspect: 20 / 9, stb: 0.87, tech: 'bezel_punch' },
  { id: 'udc', name: 'Under-display camera', aspect: 20 / 9, stb: 0.9, tech: 'bezel_udc' },
  { id: 'true', name: 'True full-screen', aspect: 20.5 / 9, stb: 0.94, tech: 'bezel_true' },
];
D.bezelT = (id) => D.bezels.find((r) => r.id === id);

/* ---------- Battery ---------- */
D.batChem = [
  { id: 'li', name: 'Li-ion', year: 2005, whl: 420, prem: 1, tech: null },
  { id: 'lihd', name: 'High-density Li-ion', year: 2013, whl: 560, prem: 1.1, tech: 'bat_hd' },
  { id: 'lipo', name: 'Stacked Li-Po', year: 2018, whl: 660, prem: 1.2, tech: 'bat_stack' },
  { id: 'sic', name: 'Silicon-Carbon', year: 2023, whl: 800, prem: 1.35, tech: 'bat_sic' },
  { id: 'ss', name: 'Solid-State', year: 2029, whl: 1000, prem: 1.8, tech: 'bat_ss' },
];
D.batT = (id) => D.batChem.find((r) => r.id === id);
D.charging = [
  { w: 5, tech: null }, { w: 10, tech: null, year: 2012 }, { w: 18, tech: 'fc1' }, { w: 33, tech: 'fc2' }, { w: 67, tech: 'fc3' }, { w: 120, tech: 'fc4' }, { w: 240, tech: 'fc5' },
];
D.wireless = [{ id: 'none', name: 'None', tech: null, w: 0 }, { id: 'qi', name: 'Wireless 10W', tech: 'wless', w: 10 }, { id: 'qi2', name: 'Fast wireless 15W+', tech: 'wless2', w: 15 }, { id: 'rev', name: 'Fast + reverse wireless', tech: 'rev_wl', w: 15 }];

/* ---------- Camera ---------- */
D.camMP = [{ mp: 3, tech: null }, { mp: 5, tech: null }, { mp: 8, tech: 'cam_8' }, { mp: 13, tech: 'cam_13' }, { mp: 16, tech: 'cam_16' }, { mp: 48, tech: 'cam_48' }, { mp: 108, tech: 'cam_108' }, { mp: 200, tech: 'cam_200' }];
D.sensors = [
  { id: 's4', name: '1/4"', area: 12, tech: null }, { id: 's32', name: '1/3.2"', area: 15.5, tech: null },
  { id: 's26', name: '1/2.6"', area: 24, tech: 'cam_mid' }, { id: 's17', name: '1/1.7"', area: 38, tech: 'cam_large' },
  { id: 's13', name: '1/1.3"', area: 68, tech: 'cam_xl' }, { id: 's1', name: '1-inch', area: 116, tech: 'cam_1in' },
];
D.sensorT = (id) => D.sensors.find((r) => r.id === id);
D.frontMP = [{ mp: 0, year: 0 }, { mp: 0.3, year: 2008 }, { mp: 1.3, year: 2010 }, { mp: 2, year: 2012 }, { mp: 5, year: 2014 }, { mp: 8, year: 2016 }, { mp: 12, year: 2019 }, { mp: 32, year: 2021 }];
D.extraCams = [
  { id: 'macro', name: '2MP macro (cheap)', tech: null, year: 2018, cost: 1.5, score: 0.5 },
  { id: 'ultra', name: 'Ultra-wide', tech: 'cam_dual', cost: 7, score: 6 },
  { id: 'tele', name: 'Telephoto 3×', tech: 'cam_tele', cost: 9, score: 7 },
  { id: 'peri', name: 'Periscope 5–10×', tech: 'cam_peri', cost: 16, score: 10 },
];

/* ---------- Body ---------- */
D.materials = [
  { id: 'plastic', name: 'Polycarbonate', prem: 0.3, cond: 0.75, cost: 3, wt: 0.9, tech: null },
  { id: 'alu', name: 'Aluminum unibody', prem: 0.62, cond: 1.2, cost: 14, wt: 1.0, tech: 'mat_alu' },
  { id: 'glass', name: 'Glass & aluminum', prem: 0.74, cond: 0.95, cost: 22, wt: 1.08, tech: 'mat_glass' },
  { id: 'steel', name: 'Glass & stainless steel', prem: 0.84, cond: 1.0, cost: 34, wt: 1.25, tech: 'mat_steel' },
  { id: 'ceramic', name: 'Ceramic', prem: 0.9, cond: 0.9, cost: 44, wt: 1.2, tech: 'mat_ceramic' },
  { id: 'ti', name: 'Titanium & glass', prem: 0.96, cond: 0.98, cost: 52, wt: 1.03, tech: 'mat_ti' },
];
D.matT = (id) => D.materials.find((r) => r.id === id);
D.forms = [
  { id: 'bar', name: 'Classic slate', tech: null },
  { id: 'rugged', name: 'Rugged slate', tech: null },
  { id: 'fold', name: 'Foldable', tech: 'fold' },
];
D.ipRatings = [{ id: 'none', name: 'None', tech: null }, { id: 'ip67', name: 'IP67', tech: 'ip67' }, { id: 'ip68', name: 'IP68', tech: 'ip68' }];
D.biometrics = [{ id: 'none', name: 'PIN only', tech: null }, { id: 'fp', name: 'Fingerprint', tech: 'bio_fp' }, { id: 'ufp', name: 'In-display fingerprint', tech: 'bio_ufp' }, { id: 'face', name: '3D face unlock', tech: 'bio_face' }];
D.cooling = [{ id: 'graphite', name: 'Graphite sheet', tech: null, k: 1 }, { id: 'vc', name: 'Vapor chamber', tech: 'cool_vc', k: 1.32 }, { id: 'graphene', name: 'Vapor chamber + graphene', tech: 'cool_gr', k: 1.5 }, { id: 'fan', name: 'Active fan (gaming)', tech: 'cool_fan', k: 1.95 }];

/* ---------- Tech tree ----------
   [id, name, field, category, year, weight, cash(k$ base), reqs, effect description]
   field: sil (silicon), hw (hardware), sw (software), mfg (manufacturing) */
D.FIELDS = { hw: { name: 'Hardware', icon: '🔧', color: '#4cc9f0' }, sil: { name: 'Silicon', icon: '🧠', color: '#b388ff' }, sw: { name: 'Software', icon: '💻', color: '#7ee787' }, mfg: { name: 'Manufacturing', icon: '🏭', color: '#ffb648' } };
const T_ = [
  // --- Silicon: SoC & CPU ---
  ['soc', 'SoC Integration Fundamentals', 'sil', 'CPU & SoC', 2009, 1.5, 30, [], 'Lets you design your own system-on-chip with licensed CPU/GPU cores.'],
  ['bigLittle', 'Heterogeneous big.LITTLE', 'sil', 'CPU & SoC', 2013, 2, 60, ['soc'], 'Mix performance and efficiency cores in your chip designs.'],
  ['dvfs', 'Advanced DVFS Power Management', 'sil', 'CPU & SoC', 2014, 2, 80, ['soc'], 'Chip power −8%.'],
  ['sram', 'High-Density SRAM Cells', 'sil', 'CPU & SoC', 2016, 2.5, 120, ['soc'], 'Cache uses 20% fewer transistors.'],
  ['chiplet', 'Chiplet Packaging', 'sil', 'CPU & SoC', 2023, 3, 400, ['soc'], 'Large dies yield as if 40% smaller.'],
  ['ipreuse', 'Design IP Reuse Library', 'sil', 'CPU & SoC', 2012, 2, 60, ['soc'], 'Chip design effort −25%.'],
  ...D.cpuGens.map((c, i) => ['cpu' + c.g, 'Custom CPU Core Gen ' + c.g, 'sil', 'CPU & SoC', c.year, 3 + c.g * 0.35, 80 * Math.pow(1.3, i), i ? ['cpu' + (c.g - 1)] : ['soc'], 'In-house core: +10% IPC, −10% power, no royalties vs licensed Gen ' + c.g + '.']),
  ...D.gpuGens.map((c, i) => ['gpu' + c.g, 'Custom GPU Architecture Gen ' + c.g, 'sil', 'GPU & AI', c.year, 2.6 + c.g * 0.3, 70 * Math.pow(1.3, i), i ? ['gpu' + (c.g - 1)] : ['soc'], 'In-house GPU: +12% throughput per watt, no royalties.' + (c.rt ? ' Hardware ray tracing.' : '')]),
  ...D.npuGens.slice(1).map((c, i) => ['npu' + c.g, 'Neural Engine Gen ' + c.g, 'sil', 'GPU & AI', c.year, 2.4 + c.g * 0.3, 120 * Math.pow(1.3, i), i ? ['npu' + (c.g - 1)] : ['soc'], 'On-chip AI accelerator (' + c.tops + ' TOPS per unit).']),
  ...D.ispGens.map((c, i) => ['isp' + c.g, 'Image Signal Processor Gen ' + c.g, 'sil', 'Imaging & Modem', c.year, 2 + c.g * 0.25, 50 * Math.pow(1.25, i), i ? ['isp' + (c.g - 1)] : ['soc'], 'In-house ISP: up to ' + c.maxMP + 'MP, ' + c.video + ' video.']),
  ...D.modems.slice(1).map((c, i) => ['modem' + c.g, 'Integrated ' + c.name + ' Modem', 'sil', 'Imaging & Modem', c.year, 4 + c.g * 0.5, 200 * Math.pow(1.35, i), i ? ['modem' + (c.g - 1)] : ['soc'], 'Integrate your own ' + c.name + ' modem: lower power, no discrete modem or royalties.']),
  // --- Manufacturing: fabs & assembly ---
  ['fabbasics', 'Semiconductor Process Engineering', 'mfg', 'Fabrication', 2005, 5, 3000, ['soc'], 'Required before building your own chip fabs.'],
  ...D.nodes.map((n, i) => ['fab' + n.id.slice(1), 'Fab Process: ' + n.nm, 'mfg', 'Fabrication', n.year, 6 + i * 1.2, Math.round(n.fab / 1000 * 0.04), i ? ['fab' + D.nodes[i - 1].id.slice(1)].concat(n.id === 'n5' ? ['euv'] : []) : ['fabbasics'], 'Lets you build your own ' + n.nm + ' fab.']),
  ['euv', 'EUV Lithography', 'mfg', 'Fabrication', 2019, 14, 250000, ['fab10'], 'Required for 5nm and below.'],
  ['auto1', 'Assembly Automation I', 'mfg', 'Assembly', 2010, 1.2, 40, [], 'Line capacity +25%, defects −10%.'],
  ['auto2', 'Assembly Automation II', 'mfg', 'Assembly', 2013, 1.8, 150, ['auto1'], 'Line capacity +25% more, defects −10%.'],
  ['auto3', 'Robotic Assembly III', 'mfg', 'Assembly', 2017, 2.4, 600, ['auto2'], 'Line capacity +35% more, labour cost −20%.'],
  ['auto4', 'Smart Factory IV', 'mfg', 'Assembly', 2022, 3, 2000, ['auto3'], 'Line capacity +35% more, labour cost −20%.'],
  ['auto5', 'Lights-out AI Factory', 'mfg', 'Assembly', 2028, 4, 6000, ['auto4'], 'Line capacity +40% more, labour cost −30%.'],
  ['qc1', 'Statistical Quality Control', 'mfg', 'Quality', 2010, 1, 25, [], 'Defect rate −25%.'],
  ['qc2', 'Automated Optical Inspection', 'mfg', 'Quality', 2013, 1.8, 120, ['qc1'], 'Defect rate −30%.'],
  ['qc3', 'AI Defect Detection', 'mfg', 'Quality', 2020, 2.5, 700, ['qc2'], 'Defect rate −35%. Recalls far less likely.'],
  ['scm1', 'Supply Chain Optimization', 'mfg', 'Supply Chain', 2011, 1.5, 50, [], 'Component costs −3%.'],
  ['scm2', 'Global Procurement Network', 'mfg', 'Supply Chain', 2015, 2.2, 300, ['scm1'], 'Component costs −4%.'],
  ['scm3', 'Vertical Integration', 'mfg', 'Supply Chain', 2020, 3, 1500, ['scm2'], 'Component costs −5%.'],
  // --- Hardware: display ---
  ['disp_ips', 'IPS LCD Integration', 'hw', 'Display', 2010, 0.9, 12, [], 'Use IPS LCD panels: better colours and viewing angles.'],
  ['disp_amoled', 'AMOLED Integration', 'hw', 'Display', 2010.5, 2.2, 90, ['disp_ips'], 'Use AMOLED panels: deep blacks, lower power.'],
  ['disp_amoled2', 'Dynamic AMOLED', 'hw', 'Display', 2016, 2.4, 160, ['disp_amoled'], 'Brighter, more efficient OLED panels.'],
  ['disp_ltpo', 'LTPO Adaptive Panels', 'hw', 'Display', 2021, 2.8, 300, ['disp_amoled2', 'disp_120'], 'Adaptive 1–120Hz, best efficiency.'],
  ['disp_micro', 'MicroLED Panels', 'hw', 'Display', 2030, 4, 900, ['disp_ltpo'], 'The ultimate display technology.'],
  ['disp_hd', 'HD 720p Display Driving', 'hw', 'Display', 2012, 1.2, 30, [], 'Enables 720p screens.'],
  ['disp_fhd', 'Full HD Display Driving', 'hw', 'Display', 2013, 1.5, 60, ['disp_hd'], 'Enables 1080p screens.'],
  ['disp_qhd', 'Quad HD Display Driving', 'hw', 'Display', 2014, 1.8, 90, ['disp_fhd'], 'Enables 1440p screens.'],
  ['disp_4k', '4K Mobile Panels', 'hw', 'Display', 2016, 2, 140, ['disp_qhd'], 'Enables 2160p screens (power hungry).'],
  ['disp_90', '90Hz Refresh', 'hw', 'Display', 2019, 1.6, 120, [], 'Smoother 90Hz screens.'],
  ['disp_120', '120Hz Refresh', 'hw', 'Display', 2020, 1.8, 160, ['disp_90'], '120Hz screens.'],
  ['disp_144', '144Hz Gaming Panels', 'hw', 'Display', 2022, 2, 200, ['disp_120'], '144Hz screens.'],
  ['disp_165', '165Hz Esports Panels', 'hw', 'Display', 2023, 2.2, 240, ['disp_144'], '165Hz screens.'],
  ['bezel_18', '18:9 Full-View Design', 'hw', 'Display', 2017, 1.6, 90, [], 'Taller screens with slim bezels.'],
  ['bezel_notch', 'Notch Display', 'hw', 'Display', 2017.7, 1.6, 110, ['bezel_18'], 'Edge-to-edge with a notch.'],
  ['bezel_punch', 'Punch-hole Display', 'hw', 'Display', 2019, 1.8, 140, ['bezel_notch'], 'Tiny camera hole, 20:9.'],
  ['bezel_udc', 'Under-Display Camera', 'hw', 'Display', 2021, 2.6, 260, ['bezel_punch'], 'No visible camera at all.'],
  ['bezel_true', 'True Full-Screen', 'hw', 'Display', 2027, 3, 500, ['bezel_udc'], 'Virtually bezel-less.'],
  ['fold', 'Foldable Display', 'hw', 'Display', 2019, 4, 700, ['disp_amoled2'], 'Unlocks the foldable form factor.'],
  ['glass2', 'Toughened Cover Glass', 'hw', 'Build', 2012, 1, 25, [], 'Far fewer cracked screens. Durability +.'],
  ['glass3', 'Ceramic-Shield Glass', 'hw', 'Build', 2020, 1.6, 150, ['glass2'], 'Durability ++.'],
  // --- Hardware: memory/storage integration ---
  ['ram_lp2', 'LPDDR2 Integration', 'hw', 'Memory', 2011, 0.8, 15, [], 'Use LPDDR2 memory.'],
  ['ram_lp3', 'LPDDR3 Integration', 'hw', 'Memory', 2013, 1, 30, ['ram_lp2'], 'Use LPDDR3 memory.'],
  ['ram_ddr4', 'Standard DDR4 Integration', 'hw', 'Memory', 2015, 0.8, 30, [], 'Cheap but power-hungry DDR4.'],
  ['ram_lp4', 'LPDDR4 Integration', 'hw', 'Memory', 2015, 1.1, 50, ['ram_lp3'], 'Use LPDDR4 memory.'],
  ['ram_lp4x', 'LPDDR4X Integration', 'hw', 'Memory', 2017, 1.1, 60, ['ram_lp4'], 'Use LPDDR4X memory.'],
  ['ram_lp5', 'LPDDR5 Integration', 'hw', 'Memory', 2020, 1.2, 90, ['ram_lp4x'], 'Use LPDDR5 memory.'],
  ['ram_ddr5', 'Standard DDR5 Integration', 'hw', 'Memory', 2021, 1, 80, ['ram_ddr4'], 'Cheap DDR5.'],
  ['ram_lp5x', 'LPDDR5X Integration', 'hw', 'Memory', 2022, 1.2, 110, ['ram_lp5'], 'Use LPDDR5X memory.'],
  ['ram_lp6', 'LPDDR6 Integration', 'hw', 'Memory', 2026, 1.3, 160, ['ram_lp5x'], 'Use LPDDR6 memory.'],
  ['ram_lp6x', 'LPDDR6X Integration', 'hw', 'Memory', 2029, 1.4, 220, ['ram_lp6'], 'Use LPDDR6X memory.'],
  ['ram_lp7', 'LPDDR7 Integration', 'hw', 'Memory', 2032, 1.5, 300, ['ram_lp6x'], 'Use LPDDR7 memory.'],
  ['sto_ufs2', 'UFS 2.1 Storage', 'hw', 'Memory', 2016, 1, 50, [], 'Fast UFS storage.'],
  ['sto_ufs3', 'UFS 3.1 Storage', 'hw', 'Memory', 2019, 1.1, 80, ['sto_ufs2'], 'Faster UFS 3.1.'],
  ['sto_ufs4', 'UFS 4.0 Storage', 'hw', 'Memory', 2022, 1.2, 110, ['sto_ufs3'], 'UFS 4.0.'],
  ['sto_ufs5', 'UFS 5.0 Storage', 'hw', 'Memory', 2027, 1.3, 160, ['sto_ufs4'], 'UFS 5.0.'],
  // --- Hardware: battery ---
  ['bat_hd', 'High-Density Li-ion Cells', 'hw', 'Battery', 2013, 1.6, 60, [], 'Energy density 420 → 560 Wh/L.'],
  ['bat_stack', 'Stacked Li-Po Cells', 'hw', 'Battery', 2018, 2, 140, ['bat_hd'], '660 Wh/L.'],
  ['bat_sic', 'Silicon-Carbon Anode', 'hw', 'Battery', 2023, 2.6, 300, ['bat_stack'], '800 Wh/L.'],
  ['bat_ss', 'Solid-State Battery', 'hw', 'Battery', 2029, 4, 1200, ['bat_sic'], '1000 Wh/L and safer.'],
  ['fc1', 'Fast Charging 18W', 'hw', 'Battery', 2015, 1, 30, [], '18W charging.'],
  ['fc2', 'Fast Charging 33W', 'hw', 'Battery', 2018, 1.2, 60, ['fc1'], '33W charging.'],
  ['fc3', 'SuperCharge 67W', 'hw', 'Battery', 2020, 1.5, 100, ['fc2'], '67W charging.'],
  ['fc4', 'HyperCharge 120W', 'hw', 'Battery', 2022, 1.8, 160, ['fc3'], '120W charging.'],
  ['fc5', 'Flash Charge 240W', 'hw', 'Battery', 2026, 2.2, 260, ['fc4'], '240W charging.'],
  ['wless', 'Wireless Charging', 'hw', 'Battery', 2012, 1.2, 40, [], '10W wireless charging.'],
  ['wless2', 'Fast Wireless Charging', 'hw', 'Battery', 2018, 1.4, 80, ['wless'], '15W+ wireless charging.'],
  ['rev_wl', 'Reverse Wireless Charging', 'hw', 'Battery', 2019, 1.4, 90, ['wless2'], 'Charge earbuds on your phone.'],
  // --- Hardware: camera ---
  ['cam_8', '8MP Camera Modules', 'hw', 'Camera', 2010, 0.8, 10, [], '8MP sensors.'],
  ['cam_13', '13MP Camera Modules', 'hw', 'Camera', 2012, 1, 25, ['cam_8'], '13MP sensors.'],
  ['cam_16', '16MP Camera Modules', 'hw', 'Camera', 2014, 1.2, 40, ['cam_13'], '16MP sensors.'],
  ['cam_48', 'Quad-Bayer 48MP', 'hw', 'Camera', 2019, 1.6, 90, ['cam_16'], '48MP pixel-binning sensors.'],
  ['cam_108', '108MP Sensors', 'hw', 'Camera', 2020, 1.8, 130, ['cam_48'], '108MP sensors.'],
  ['cam_200', '200MP Sensors', 'hw', 'Camera', 2023, 2.2, 200, ['cam_108'], '200MP sensors.'],
  ['cam_ois', 'Optical Image Stabilization', 'hw', 'Camera', 2012, 1.3, 40, [], 'Sharper low-light photos & video.'],
  ['cam_mid', 'Larger Sensors (1/2.6")', 'hw', 'Camera', 2014, 1.2, 40, [], 'Bigger pixels.'],
  ['cam_large', 'Large Sensors (1/1.7")', 'hw', 'Camera', 2016, 1.6, 80, ['cam_mid'], 'Much better low light.'],
  ['cam_xl', 'XL Sensors (1/1.3")', 'hw', 'Camera', 2020, 2, 150, ['cam_large'], 'Near-compact-camera quality.'],
  ['cam_1in', '1-inch Sensors', 'hw', 'Camera', 2022, 2.4, 260, ['cam_xl'], 'Huge 1-inch sensors.'],
  ['cam_dual', 'Ultra-wide Second Camera', 'hw', 'Camera', 2016, 1.4, 60, [], 'Adds an ultra-wide camera option.'],
  ['cam_tele', 'Telephoto Module', 'hw', 'Camera', 2016.5, 1.6, 80, ['cam_dual'], 'Adds a 3× telephoto option.'],
  ['cam_peri', 'Periscope Zoom', 'hw', 'Camera', 2019, 2.2, 160, ['cam_tele'], 'Adds a periscope zoom option.'],
  // --- Hardware: build ---
  ['mat_alu', 'Aluminum Unibody', 'hw', 'Build', 2012, 1.2, 50, [], 'Premium metal bodies.'],
  ['mat_glass', 'Glass & Metal Design', 'hw', 'Build', 2013, 1.4, 80, ['mat_alu'], 'Glass back, metal frame.'],
  ['mat_steel', 'Stainless Steel Frames', 'hw', 'Build', 2017, 1.6, 120, ['mat_glass'], 'Luxury steel frames.'],
  ['mat_ceramic', 'Ceramic Bodies', 'hw', 'Build', 2018, 1.8, 140, ['mat_glass'], 'Scratch-proof ceramic.'],
  ['mat_ti', 'Titanium Frames', 'hw', 'Build', 2023, 2, 220, ['mat_steel'], 'Light and strong titanium.'],
  ['ip67', 'IP67 Water Resistance', 'hw', 'Build', 2014, 1.4, 60, [], 'Survives a splash and a dunk.'],
  ['ip68', 'IP68 Water Resistance', 'hw', 'Build', 2016, 1.6, 90, ['ip67'], 'Survives a swim.'],
  ['cool_vc', 'Vapor Chamber Cooling', 'hw', 'Build', 2016, 1.6, 70, [], 'Sustained performance +32%.'],
  ['cool_gr', 'Graphene Thermal Film', 'hw', 'Build', 2021, 1.8, 120, ['cool_vc'], 'Sustained performance +50%.'],
  ['cool_fan', 'Active Cooling Fan', 'hw', 'Build', 2020, 1.6, 100, ['cool_vc'], 'Gaming-phone fan cooling. Thick but cool.'],
  ['bio_fp', 'Fingerprint Sensor', 'hw', 'Build', 2013, 1.2, 40, [], 'Fingerprint unlock.'],
  ['bio_face', '3D Face Unlock', 'hw', 'Build', 2017.7, 2.2, 160, ['bio_fp'], 'Secure 3D face recognition.'],
  ['bio_ufp', 'In-Display Fingerprint', 'hw', 'Build', 2019, 1.8, 120, ['bio_fp'], 'Fingerprint under the screen.'],
  ['stereo', 'Stereo Speakers', 'hw', 'Build', 2014, 0.9, 20, [], 'Better audio and gaming.'],
  ['haptics', 'Precision Haptics', 'hw', 'Build', 2017, 1, 30, [], 'Premium-feeling vibration.'],
  // --- Software ---
  ['os_skin1', 'Custom UI Skin', 'sw', 'Operating System', 2010, 1, 10, [], 'Your own look on OpenMobile OS. Software +8.'],
  ['os_skin2', 'Refined UI & Animations', 'sw', 'Operating System', 2013, 1.5, 40, ['os_skin1'], 'Software +8.'],
  ['os_skin3', 'Ultra-smooth UI', 'sw', 'Operating System', 2019, 2, 150, ['os_skin2'], 'Software +8.'],
  ['os_updates', 'Long-term Update Program', 'sw', 'Operating System', 2015, 1.5, 80, ['os_skin1'], 'Software +6, reputation grows faster.'],
  ['os_kernel', 'Proprietary Mobile Kernel', 'sw', 'Operating System', 2011, 4, 400, ['os_skin1'], 'First step to your own OS.'],
  ['os_own', 'Own Operating System 1.0', 'sw', 'Operating System', 2012, 7, 1500, ['os_kernel'], 'Ship your own OS: no license fees, but you need an app ecosystem.'],
  ['os_own2', 'OS 2.0 · Fluid Platform', 'sw', 'Operating System', 2016, 6, 3000, ['os_own'], 'Own-OS software +10.'],
  ['os_own3', 'OS 3.0 · Intelligent Platform', 'sw', 'Operating System', 2022, 7, 8000, ['os_own2'], 'Own-OS software +10.'],
  ['appstore', 'Proprietary App Store', 'sw', 'Ecosystem', 2012, 4, 1000, ['os_own'], 'Earn services revenue and grow your app ecosystem.'],
  ['devprog', 'Developer Incentive Program', 'sw', 'Ecosystem', 2013, 3, 2000, ['appstore'], 'App ecosystem grows 60% faster.'],
  ['cloud', 'Cloud Services Ecosystem', 'sw', 'Ecosystem', 2014, 4, 3000, ['appstore'], 'Services revenue ×2, customers stay loyal.'],
  ['voice', 'Voice Assistant', 'sw', 'Features', 2011, 2, 120, [], 'Feature score +.'],
  ['ai_assist', 'On-device AI Assistant', 'sw', 'Features', 2023, 3.5, 1200, ['voice'], 'Huge feature boost in the AI era (needs NPU).'],
  ['secure', 'Secure Enclave & Mobile Payments', 'sw', 'Features', 2014, 2, 150, [], 'Feature score +.'],
  ['comp_photo', 'Computational Photography', 'sw', 'Camera Software', 2016, 2.2, 160, [], 'Camera +10%.'],
  ['night', 'Night Mode', 'sw', 'Camera Software', 2018, 2.2, 200, ['comp_photo'], 'Night photos +25%.'],
  ['ai_photo', 'Generative AI Photo Engine', 'sw', 'Camera Software', 2023, 3, 700, ['night'], 'Camera +10%, needs NPU.'],
  ['batt_opt', 'Battery Optimization Daemon', 'sw', 'System', 2013, 1.4, 40, [], 'Average power −15%.'],
  ['batt_opt2', 'AI Adaptive Battery', 'sw', 'System', 2018, 1.8, 150, ['batt_opt'], 'Average power −15% more.'],
  ['thermal', 'Thermal Throttling Firmware', 'sw', 'System', 2012, 1.2, 30, [], 'Smoother throttling, overheating far less likely.'],
  ['gamemode', 'Game Mode & Frame Pacing', 'sw', 'System', 2017, 1.5, 80, ['thermal'], 'Sustained gaming FPS +8%.'],
  ['stability', 'Software QA & Stability Lab', 'sw', 'System', 2011, 1.3, 40, [], 'App crash risk −40%.'],
  ['stability2', 'Automated Regression Testing', 'sw', 'System', 2016, 1.8, 140, ['stability'], 'Crash risk −40% more.'],
  ['benchboost', 'Benchmark Boost Mode', 'sw', 'System', 2013, 1, 20, [], 'Optional cheat: +15% benchmark scores. Getting caught is a scandal.'],
];
D.techs = T_.map(([id, name, field, cat, year, w, cash, req, desc]) => ({
  id, name, field, cat, year, w, req,
  rp: Math.round(30 * Math.pow(1.19, year - 2010) * w),
  cash: Math.round(cash * 1000 * (cash >= 1000 ? 1 : Math.pow(1.12, Math.max(0, year - 2010)))),
  desc,
}));
D.tech = {}; D.techs.forEach((t) => (D.tech[t.id] = t));
// Techs for CPU/GPU/etc. used when licensing instead of in-house research
D.licenseFee = (kind, g) => ({ cpu: 0.8e6, gpu: 0.6e6, npu: 0.5e6, isp: 0.3e6 }[kind] * Math.pow(1.22, g - 1));

/* ---------- Staff ---------- */
D.tiers = [
  { id: 'junior', name: 'Junior', rp: 6, sal: 6500, skill: 25 },
  { id: 'mid', name: 'Mid-level', rp: 10, sal: 9500, skill: 50 },
  { id: 'senior', name: 'Senior', rp: 16, sal: 14000, skill: 75 },
  { id: 'principal', name: 'Principal', rp: 26, sal: 22000, skill: 95 },
];
D.roles = {
  hw: { name: 'Hardware Engineers', icon: '🔧' },
  sil: { name: 'Silicon Engineers', icon: '🧠' },
  sw: { name: 'Software Engineers', icon: '💻' },
  mfg: { name: 'Manufacturing Engineers', icon: '🏭' },
  mkt: { name: 'Marketing Staff', icon: '📣' },
  sales: { name: 'Sales & Partnerships', icon: '🤝' },
};

/* ---------- Facilities ---------- */
D.facilities = [
  { id: 'workshop', name: 'Garage Workshop', build: 0, maxLines: 4, lineCap: 250, lineCost: 3500, lineOpex: 1500, base: 1800, defect: 0.07, months: 0 },
  { id: 'plant', name: 'Small Assembly Plant', build: 650000, maxLines: 6, lineCap: 3000, lineCost: 90000, lineOpex: 14000, base: 20000, defect: 0.045, months: 3 },
  { id: 'factory', name: 'Assembly Factory', build: 9e6, maxLines: 12, lineCap: 25000, lineCost: 1.2e6, lineOpex: 85000, base: 220000, defect: 0.03, months: 8 },
  { id: 'mega', name: 'Mega Factory Campus', build: 160e6, maxLines: 20, lineCap: 150000, lineCost: 12e6, lineOpex: 420000, base: 2.5e6, defect: 0.02, months: 18 },
];
D.facT = (id) => D.facilities.find((f) => f.id === id);

/* ---------- Rivals ---------- */
D.rivals = [
  { id: 'nimbus', name: 'Nimbus', color: '#a8b3c4', tiers: ['flagship', 'premium'], tech: 1.04, rep: 84, ownOS: true, month: 8, priceMul: 1.15, focus: 'balanced', arc: [[2010, 1.0], [2030, 1.02]], regions: { na: 0.95, eu: 0.85, eas: 0.85, cn: 0.6, in: 0.25, sea: 0.5, latam: 0.4, mea: 0.45 }, start: 2010 },
  { id: 'vantage', name: 'Vantage Digital', color: '#3a7bfd', tiers: ['budget', 'mid', 'premium', 'flagship'], tech: 1.0, rep: 68, month: 2, priceMul: 1.0, focus: 'display', arc: [[2010, 0.96], [2014, 1.0], [2030, 1.0]], regions: { na: 0.85, eu: 0.9, eas: 0.9, cn: 0.6, in: 0.8, sea: 0.85, latam: 0.85, mea: 0.85 }, start: 2010 },
  { id: 'kestrel', name: 'Kestrel Mobile', color: '#22a866', tiers: ['budget', 'mid', 'premium'], tech: 0.9, rep: 76, legacyOS: true, month: 4, priceMul: 1.0, focus: 'camera', arc: [[2010, 0.92], [2012, 0.8], [2015, 0.7], [2030, 0.7]], regions: { na: 0.6, eu: 0.95, eas: 0.5, cn: 0.75, in: 0.9, sea: 0.85, latam: 0.85, mea: 0.95 }, start: 2010, exitBelow: 0.012 },
  { id: 'orion', name: 'Orion Wireless', color: '#6d4bd8', tiers: ['mid', 'premium'], tech: 0.88, rep: 72, legacyOS: true, month: 5, priceMul: 1.05, focus: 'battery', arc: [[2010, 0.92], [2012, 0.78], [2014, 0.68], [2030, 0.65]], regions: { na: 0.9, eu: 0.75, eas: 0.3, cn: 0.2, in: 0.4, sea: 0.5, latam: 0.6, mea: 0.6 }, start: 2010, exitBelow: 0.01 },
  { id: 'xinghe', name: 'Xinghe Tech', color: '#ff7a1a', tiers: ['budget', 'mid', 'flagship'], tech: 0.96, rep: 18, month: 7, priceMul: 0.78, focus: 'performance', arc: [[2011, 0.9], [2016, 0.98], [2030, 1.0]], regions: { na: 0.0, eu: 0.15, eas: 0.1, cn: 0.6, in: 0.3, sea: 0.3, latam: 0.1, mea: 0.15 }, grow: 0.06, start: 2011.5 },
  { id: 'lumora', name: 'Lumora', color: '#e0474c', tiers: ['budget', 'mid', 'premium', 'flagship'], tech: 0.96, rep: 40, month: 3, priceMul: 0.95, focus: 'camera', arc: [[2010, 0.85], [2016, 0.99], [2030, 1.01]], regions: { na: 0.1, eu: 0.35, eas: 0.15, cn: 0.75, in: 0.3, sea: 0.5, latam: 0.35, mea: 0.6 }, grow: 0.04, start: 2010 },
  { id: 'bolt', name: 'Bolt Mobile', color: '#f4c20d', tiers: ['budget', 'mid'], tech: 0.82, rep: 34, month: 5, priceMul: 0.82, focus: 'battery', arc: [[2010, 0.85], [2030, 0.9]], regions: { na: 0.15, eu: 0.25, eas: 0.1, cn: 0.3, in: 0.85, sea: 0.8, latam: 0.75, mea: 0.85 }, grow: 0.02, start: 2010 },
];

/* ---------- Mobile games for demos & tests ---------- */
D.games = [
  { id: 'birds', name: 'Pocket Birds', year: 2010, load: 0.12, cpu: 300, ram: 0.2, cap: 60, genre: '2D casual' },
  { id: 'velocity', name: 'Velocity Rush', year: 2011, load: 0.45, cpu: 450, ram: 0.4, cap: 60, genre: '3D racing' },
  { id: 'shadow', name: 'Shadow Strike', year: 2013, load: 0.9, cpu: 650, ram: 1, cap: 60, genre: 'Shooter' },
  { id: 'arena', name: 'Arena Legends', year: 2016, load: 3.4, cpu: 900, ram: 2, cap: 120, genre: 'MOBA' },
  { id: 'royale', name: 'Battle Zone Royale', year: 2018, load: 7.5, cpu: 1300, ram: 3, cap: 120, genre: 'Battle royale' },
  { id: 'astral', name: 'Astral Odyssey', year: 2020, load: 13, cpu: 1700, ram: 4, cap: 60, genre: 'Open-world RPG' },
  { id: 'neon', name: 'Neon Frontier RT', year: 2023, load: 28, cpu: 2200, ram: 8, cap: 144, genre: 'Ray-traced shooter', rt: true },
  { id: 'quantum', name: 'Quantum Siege', year: 2027, load: 70, cpu: 3000, ram: 12, cap: 165, genre: 'Next-gen open world', rt: true },
  { id: 'holo', name: 'Holo Realms', year: 2031, load: 160, cpu: 4200, ram: 16, cap: 165, genre: 'Holographic MMO', rt: true },
];
D.gfxPresets = [{ id: 'low', name: 'Low', m: 0.5 }, { id: 'med', name: 'Medium', m: 0.75 }, { id: 'high', name: 'High', m: 1 }, { id: 'ultra', name: 'Ultra', m: 1.55 }];

/* ---------- Setup choices ---------- */
D.strategies = [
  { id: 'value', name: 'Value Disruptor', desc: 'Great specs, thin margins. Word of mouth grows 30% faster.' },
  { id: 'premium', name: 'Premium Brand', desc: 'Design & brand first. Reputation gains +20%, buyers less price sensitive.' },
  { id: 'tech', name: 'Technology Pioneer', desc: 'Research 15% faster. Investors love you, but expect breakthroughs.' },
  { id: 'lean', name: 'Lean Operator', desc: 'Salaries & overheads 12% cheaper. Slower brand growth.' },
];
D.categories = [
  { id: 'budget', name: 'Budget Smartphone', tpl: 'budget', desc: 'Cheap, cheerful, high volume.' },
  { id: 'mid', name: 'Mid-range Smartphone', tpl: 'mid', desc: 'Balanced specs at a fair price.' },
  { id: 'rugged', name: 'Rugged Phone', tpl: 'rugged', desc: 'Tough phones for workers & adventurers.' },
  { id: 'gaming', name: 'Gaming Phone', tpl: 'gaming', desc: 'Performance and cooling above all.' },
  { id: 'camera', name: 'Camera Phone', tpl: 'camera', desc: 'Win on photography.' },
  { id: 'flagship', name: 'Premium Flagship', tpl: 'flagship', desc: 'The hardest way in: compete with giants.' },
];
D.specializations = [
  { id: 'hw', name: 'Hardware Engineering', desc: 'Start with 2 hardware engineers. Hardware research +20%.' },
  { id: 'sil', name: 'Chip Design', desc: 'One silicon engineer. Silicon research +20%.' },
  { id: 'sw', name: 'Software & OS', desc: 'One software engineer. Software research +20%.' },
  { id: 'mfg', name: 'Manufacturing', desc: 'One manufacturing engineer. Manufacturing research +20%, defects −15%.' },
];
D.logoShapes = ['circle', 'square', 'hex', 'diamond', 'leaf', 'bolt'];
D.logoColors = ['#ff3b5c', '#ff8a00', '#ffd23f', '#3ddc84', '#00c2ff', '#4f6bff', '#b04dff', '#ff4fd8', '#e8ecf1', '#1a1f2b'];
