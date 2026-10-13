import type { Movie } from "../shared/types.js";
const titles = [
  "Neon Afterglow",
  "The Quiet Orbit",
  "Paper Planets",
  "Tides of Tomorrow",
  "Midnight Expressway",
  "Wildflower Valley",
  "The Last Lighthouse",
  "Small Wonders",
  "Velvet Mystery",
  "Beyond the Summit",
  "City of Echoes",
  "Autumn Letters",
  "Electric Dreams",
  "Ocean Between Us",
  "The Brass Detective",
  "Sunday Kitchen",
  "Starlight Archive",
  "Hidden Gardens",
  "Laughing in the Rain",
  "Winter Signals",
  "Golden Hour",
  "Moonlit Machines",
  "Desert Reverie",
  "A Pocket Adventure",
];
const genres = [
  "Sci-Fi",
  "Drama",
  "Animation",
  "Documentary",
  "Thriller",
  "Adventure",
  "Mystery",
  "Comedy",
];
export const catalog: Movie[] = titles.map((title, i) => ({
  id: `sample-${i + 1}`,
  title,
  description: `An original sample catalog concept: ${["a luminous journey into the unknown", "a thoughtful story of unexpected connections", "a playful exploration of a changing world", "an atmospheric voyage full of discovery"][i % 4]}. Discovery metadata only; no commercial film stream is provided.`,
  genres: [genres[i % 8], genres[(i + 3) % 8]],
  tags: [
    ["Cozy", "Wonder", "Energetic", "Thoughtful"][i % 4],
    i % 2 ? "Together" : "Escape",
  ],
  duration: 3600 + i * 137,
  color: ["#9e76fa", "#ef9164", "#57bda8", "#658bde"][i % 4],
}));
catalog.unshift({
  id: "local-demo",
  title: "Cinema Color Journey",
  description:
    "A generated 90-second local test film: moving color fields and an animated test pattern. Playable offline from this server.",
  genres: ["Animation", "Documentary"],
  tags: ["Wonder", "Together"],
  duration: 90,
  url: "/media/demo.mp4",
  color: "#ba90ff",
});
catalog.push({
  id: "demo-audio",
  provider: "direct",
  kind: "audio",
  title: "Foyer · Evening Keys",
  artist: "Foyer procedural demo",
  description:
    "An original generated 60-second ambient melody. Local, offline and freely shareable.",
  genres: ["Ambient"],
  tags: ["Cozy", "Together"],
  duration: 60,
  url: "/media/evening-keys.m4a",
  color: "#57bda8",
});
