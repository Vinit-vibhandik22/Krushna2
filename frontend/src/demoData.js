export async function loadDemoData() {
  const files = [
    { key: 'detection', path: '/demo/detection.geojson' },
    { key: 'corridor', path: '/demo/corridor.geojson' },
    { key: 'origin', path: '/demo/origin.json' },
    { key: 'suspects', path: '/demo/suspects.geojson' },
    { key: 'tracks', path: '/demo/tracks.geojson' },
    { key: 'trajectories', path: '/demo/trajectories.json' },
    { key: 'pipelines', path: '/demo/pipelines.geojson' },
    { key: 'dossier', path: '/demo/dossier.json' },
    { key: 'metVectors', path: '/demo/met_vectors.json' },
  ];

  const results = {};

  for (const { key, path } of files) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load demo data: ${path}`);
    }
    results[key] = await response.json();
  }

  return results;
}
