// 2018 grid. `perf` scales engine power / downforce, `livery` drives the procedural paint scheme.
export const TEAMS = [
  {
    id: 'mercedes', name: 'Mercedes', full: 'Mercedes-AMG Petronas Motorsport', car: 'W09 EQ Power+',
    color: '#00D2BE', perf: { power: 1.0, aero: 1.0 },
    livery: { base: '#C8CCD0', dark: '#16181B', accent: '#00D2BE', accent2: '#00A19C', wing: '#16181B', wingAccent: '#00D2BE', metal: 0.75, rough: 0.28, halo: '#16181B', text: '#ffffff', textOn: 'dark', logo: 'MERCEDES' },
    drivers: [{ name: 'Lewis Hamilton', code: 'HAM', num: 44, helmet: ['#7d0fbf', '#f8e600'], rating: 1.0 }, { name: 'Valtteri Bottas', code: 'BOT', num: 77, helmet: ['#0f3f9d', '#ffffff'], rating: 0.985 }],
  },
  {
    id: 'ferrari', name: 'Ferrari', full: 'Scuderia Ferrari', car: 'SF71H',
    color: '#DC0000', perf: { power: 1.0, aero: 0.995 },
    livery: { base: '#C30000', dark: '#1A1A1A', accent: '#ffffff', accent2: '#8a0000', wing: '#C30000', wingAccent: '#1A1A1A', metal: 0.1, rough: 0.3, halo: '#C30000', text: '#ffffff', textOn: 'base', logo: 'FERRARI' },
    drivers: [{ name: 'Sebastian Vettel', code: 'VET', num: 5, helmet: ['#ffffff', '#d40000'], rating: 0.995 }, { name: 'Kimi Räikkönen', code: 'RAI', num: 7, helmet: ['#d40000', '#ffffff'], rating: 0.985 }],
  },
  {
    id: 'redbull', name: 'Red Bull', full: 'Aston Martin Red Bull Racing', car: 'RB14',
    color: '#1E41FF', perf: { power: 0.975, aero: 1.01 },
    livery: { base: '#1B2546', dark: '#121829', accent: '#D7182A', accent2: '#FFC906', wing: '#1B2546', wingAccent: '#D7182A', metal: 0.15, rough: 0.62, halo: '#1B2546', text: '#ffffff', textOn: 'base', logo: 'RED BULL' },
    drivers: [{ name: 'Daniel Ricciardo', code: 'RIC', num: 3, helmet: ['#ffcf00', '#0050a0'], rating: 0.995 }, { name: 'Max Verstappen', code: 'VER', num: 33, helmet: ['#f47b20', '#0d1d4a'], rating: 1.0 }],
  },
  {
    id: 'forceindia', name: 'Force India', full: 'Sahara Force India F1 Team', car: 'VJM11',
    color: '#F596C8', perf: { power: 0.99, aero: 0.975 },
    livery: { base: '#F27AB7', dark: '#1A1A1A', accent: '#ffffff', accent2: '#C9C9C9', wing: '#1A1A1A', wingAccent: '#F27AB7', metal: 0.12, rough: 0.3, halo: '#F27AB7', text: '#ffffff', textOn: 'base', logo: 'FORCE INDIA' },
    drivers: [{ name: 'Sergio Pérez', code: 'PER', num: 11, helmet: ['#ffffff', '#006847'], rating: 0.975 }, { name: 'Esteban Ocon', code: 'OCO', num: 31, helmet: ['#f596c8', '#1a3fa0'], rating: 0.975 }],
  },
  {
    id: 'williams', name: 'Williams', full: 'Williams Martini Racing', car: 'FW41',
    color: '#FFFFFF', perf: { power: 0.99, aero: 0.95 },
    livery: { base: '#F4F4F4', dark: '#131B2B', accent: '#00A0DE', accent2: '#E1251B', accent3: '#0A2E6E', wing: '#F4F4F4', wingAccent: '#131B2B', metal: 0.1, rough: 0.28, halo: '#F4F4F4', text: '#0A2E6E', textOn: 'base', logo: 'WILLIAMS' },
    drivers: [{ name: 'Lance Stroll', code: 'STR', num: 18, helmet: ['#ffffff', '#c8102e'], rating: 0.96 }, { name: 'Sergey Sirotkin', code: 'SIR', num: 35, helmet: ['#d52b1e', '#ffffff'], rating: 0.96 }],
  },
  {
    id: 'renault', name: 'Renault', full: 'Renault Sport F1 Team', car: 'R.S.18',
    color: '#FFF500', perf: { power: 0.975, aero: 0.985 },
    livery: { base: '#FFE800', dark: '#141414', accent: '#141414', accent2: '#ffffff', wing: '#141414', wingAccent: '#FFE800', metal: 0.1, rough: 0.3, halo: '#141414', text: '#141414', textOn: 'base', logo: 'RENAULT' },
    drivers: [{ name: 'Nico Hülkenberg', code: 'HUL', num: 27, helmet: ['#ffffff', '#ffe800'], rating: 0.98 }, { name: 'Carlos Sainz', code: 'SAI', num: 55, helmet: ['#ffd400', '#d40000'], rating: 0.98 }],
  },
  {
    id: 'tororosso', name: 'Toro Rosso', full: 'Red Bull Toro Rosso Honda', car: 'STR13',
    color: '#469BFF', perf: { power: 0.96, aero: 0.97 },
    livery: { base: '#1D3B8F', dark: '#11204A', accent: '#C0C5CC', accent2: '#D7182A', wing: '#1D3B8F', wingAccent: '#C0C5CC', metal: 0.35, rough: 0.35, halo: '#1D3B8F', text: '#ffffff', textOn: 'base', logo: 'TORO ROSSO' },
    drivers: [{ name: 'Pierre Gasly', code: 'GAS', num: 10, helmet: ['#0050a0', '#ffffff'], rating: 0.975 }, { name: 'Brendon Hartley', code: 'HAR', num: 28, helmet: ['#111111', '#d4d4d4'], rating: 0.96 }],
  },
  {
    id: 'haas', name: 'Haas', full: 'Haas F1 Team', car: 'VF-18',
    color: '#BD9E57', perf: { power: 1.0, aero: 0.975 },
    livery: { base: '#5A5E63', dark: '#141414', accent: '#D7141A', accent2: '#9EA3A8', wing: '#141414', wingAccent: '#D7141A', metal: 0.4, rough: 0.35, halo: '#141414', text: '#ffffff', textOn: 'base', logo: 'HAAS' },
    drivers: [{ name: 'Romain Grosjean', code: 'GRO', num: 8, helmet: ['#1a1a1a', '#e30613'], rating: 0.975 }, { name: 'Kevin Magnussen', code: 'MAG', num: 20, helmet: ['#c8102e', '#ffffff'], rating: 0.975 }],
  },
  {
    id: 'mclaren', name: 'McLaren', full: 'McLaren F1 Team', car: 'MCL33',
    color: '#FF8700', perf: { power: 0.965, aero: 0.975 },
    livery: { base: '#FF8000', dark: '#1F2A44', accent: '#2C4BA8', accent2: '#47C7FC', wing: '#25389A', wingAccent: '#FF8000', metal: 0.1, rough: 0.3, halo: '#FF8000', text: '#ffffff', textOn: 'base', logo: 'McLAREN' },
    drivers: [{ name: 'Fernando Alonso', code: 'ALO', num: 14, helmet: ['#0033a0', '#ffd100'], rating: 1.0 }, { name: 'Stoffel Vandoorne', code: 'VAN', num: 2, helmet: ['#ff8000', '#111111'], rating: 0.965 }],
  },
  {
    id: 'sauber', name: 'Sauber', full: 'Alfa Romeo Sauber F1 Team', car: 'C37',
    color: '#9B0000', perf: { power: 1.0, aero: 0.955 },
    livery: { base: '#F4F4F4', dark: '#6E0B14', accent: '#9B0000', accent2: '#1E2C55', wing: '#6E0B14', wingAccent: '#F4F4F4', metal: 0.1, rough: 0.3, halo: '#6E0B14', text: '#9B0000', textOn: 'base', logo: 'SAUBER' },
    drivers: [{ name: 'Charles Leclerc', code: 'LEC', num: 16, helmet: ['#d40000', '#ffffff'], rating: 0.985 }, { name: 'Marcus Ericsson', code: 'ERI', num: 9, helmet: ['#ffffff', '#0033a0'], rating: 0.955 }],
  },
];
