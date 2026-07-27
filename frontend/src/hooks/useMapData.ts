import { useAsyncResource } from "./useAsyncResource";
import { getLaneletGeojson } from "../api/mapApi";

export function useLaneletMap() {
  const { data, loading, error } = useAsyncResource(getLaneletGeojson, []);
  return { geojson: data, loading, error: error?.message ?? null };
}
