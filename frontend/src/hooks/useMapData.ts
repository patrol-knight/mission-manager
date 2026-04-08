import { useEffect, useState } from "react";
import { fetchLaneletMap } from "../api/rest";
import { getWebSocket } from "../api/websocket";
import type { MapData } from "../types";

/**
 * Fetches the lanelet GeoJSON map (REST, once on mount).
 * Also listens for occupancy-grid map updates pushed over WebSocket.
 */
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

/**
 * Listens for occupancy-grid map data pushed over WebSocket.
 * Decodes the raw OccupancyGrid int8 array into a canvas image.
 */
export function useOccupancyMap(): MapData | null {
  const [mapData, setMapData] = useState<MapData | null>(null);

  useEffect(() => {
    const unsub = getWebSocket().onMessage((msg) => {
      if (msg.type !== "map") return;

      const { width, height, resolution, origin_x, origin_y, data } = msg.payload;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const imageData = ctx.createImageData(width, height);

      for (let i = 0; i < data.length; i++) {
        const value = data[i];
        const gray =
          value === -1 ? 127 : 255 - Math.floor((value / 100) * 255);

        const x = i % width;
        const y = height - Math.floor(i / width) - 1; // flip Y for map coords
        const idx = (y * width + x) * 4;

        imageData.data[idx] = gray;
        imageData.data[idx + 1] = gray;
        imageData.data[idx + 2] = gray;
        imageData.data[idx + 3] = 255;
      }

      ctx.putImageData(imageData, 0, 0);

      setMapData({
        image: canvas,
        info: { width, height, resolution, origin: { x: origin_x, y: origin_y } },
      });
    });

    return unsub;
  }, []);

  return mapData;
}
