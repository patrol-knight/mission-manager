import { useEffect, useState } from "react";
import { fetchLaneletMap } from "../api/rest";

export function useLaneletMap() {
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLaneletMap()
      .then((data) => {
        if (!cancelled) {
          setGeojson(data);
          setLoading(false);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { geojson, loading, error };
}
