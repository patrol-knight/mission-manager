import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { subscribeMap, type MapData, subscribeRobotPose, type RobotPose } from "./subscriber";
import { subscribePath, type PathData } from "./subscriber";
import { useWaypoint } from "./waypoint";

export function MapView() {
  const mapRef = React.useRef<HTMLDivElement>(null);
  const map = React.useRef<maplibregl.Map | null>(null);
  const markersRef = React.useRef<Map<string, maplibregl.Marker>>(
    new Map<string, maplibregl.Marker>()
  );
  const robotMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const originalBoundsRef = React.useRef<[[number, number], [number, number]] | null>(null);

  // Zustand state
  const add = useWaypoint((s) => s.add);
  const update = useWaypoint((s) => s.update);
  const remove = useWaypoint((s) => s.remove);
  const waypoints = useWaypoint((s) => s.waypoints);
  const mode = useWaypoint((s) => s.mode);

  const [mapData, setMapData] = React.useState<MapData | null>(null);
  const [robotPose, setRobotPose] = React.useState<RobotPose | null>(null);
  const [pathData, setPathData] = React.useState<PathData | null>(null);
  const [showResetButton, setShowResetButton] = React.useState(false);

  // Subscribe to ROS map
  React.useEffect(() => {
    subscribeMap(setMapData);
  }, []);

  // Subscribe to robot pose
  React.useEffect(() => {
    subscribeRobotPose(setRobotPose);
  }, []);

  // Subscribe to mission path
  React.useEffect(() => {
    subscribePath(setPathData);
  }, []);

  // Init MapLibre
  React.useEffect(() => {
    if (!mapRef.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [],
      },
      center: [0, 0],
      zoom: 1,
      pitch: 0,
      bearing: 0, 
    });
    map.current.on("moveend", () => {
      setShowResetButton(true);
    });
  }, []);

  // Load ROS map as image layer
  React.useEffect(() => {
    if (!map.current || !mapData) return;

    const { image, info } = mapData;

    const bounds: [[number, number], [number, number]] = [
      [info.origin.x, info.origin.y],
      [
        info.origin.x + info.width * info.resolution,
        info.origin.y + info.height * info.resolution,
      ],
    ];

    originalBoundsRef.current = bounds;

    const url = image.toDataURL();

    if (map.current.getSource("ros-map")) {
      map.current.removeLayer("ros-layer");
      map.current.removeSource("ros-map");
    }

    map.current.addSource("ros-map", {
      type: "image",
      url,
      coordinates: [
        [bounds[0][0], bounds[1][1]],
        [bounds[1][0], bounds[1][1]],
        [bounds[1][0], bounds[0][1]],
        [bounds[0][0], bounds[0][1]],
      ],
    });

    map.current.addLayer({
      id: "ros-layer",
      type: "raster",
      source: "ros-map",
    });

    map.current.fitBounds(bounds, { padding: 20 });
    setShowResetButton(false);
  }, [mapData]);

  React.useEffect(() => {
    if (!map.current) return;

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (mode !== "modify") return;

      const { lng, lat } = e.lngLat;
      const clickedOnMarker = (e.originalEvent.target as HTMLElement).closest(".wp-marker");
      
      if (clickedOnMarker) return;

      add({
        id: crypto.randomUUID(),
        x: lng,
        y: lat,
        yaw: 0,
      });
    };

    map.current.on("click", handleMapClick);

    return () => {
      map.current?.off("click", handleMapClick);
    };
  }, [mode, add]);

  React.useEffect(() => {
    if (!map.current) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();

    for (const wp of waypoints) {
      const el = document.createElement("div");
      el.className = "wp-marker";
      
      el.style.width = "16px";
      el.style.height = "16px";
      el.style.background = "#ffadad";
      el.style.borderRadius = "50%";
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
      el.style.cursor = mode === "off" ? "default" : "pointer";

      const marker = new maplibregl.Marker({
        element: el,
        draggable: mode === "modify", 
      })
        .setLngLat([wp.x, wp.y])
        .addTo(map.current!);

      if (mode === "modify") {
        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          update(wp.id, pos.lng, pos.lat);
        });
      }

      if (mode === "delete") {
        el.addEventListener("click", (e) => {
          e.stopPropagation(); 
          remove(wp.id);
        });
      }

      markersRef.current.set(wp.id, marker);
    }

    // Cleanup function
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
    };
  }, [waypoints, mode, update, remove]);

  React.useEffect(() => {
    markersRef.current.forEach((marker) => {
      marker.setDraggable(mode === "modify");
      
      const el = marker.getElement();
      el.style.cursor = mode === "off" ? "default" : "pointer";
    });
  }, [mode]);

  React.useEffect(() => {
    if (!map.current || !robotPose) return;

    if (robotMarkerRef.current) {
      robotMarkerRef.current.remove();
    }

    const el = document.createElement("div");
    el.style.width = "30px";
    el.style.height = "30px";
    el.style.position = "relative";

    el.innerHTML = `
      <svg width="30" height="30" viewBox="0 0 30 30" style="transform: rotate(${-robotPose.yaw * (180 / Math.PI) + 90}deg);">
        <circle cx="15" cy="15" r="12" fill="#90e0ef" stroke="#023e8a" stroke-width="2"/>
        <path d="M 15 5 L 20 15 L 15 12 L 10 15 Z" fill="#023e8a"/>
      </svg>
    `;

    const robotMarker = new maplibregl.Marker({
      element: el,
      anchor: "center",
    })
      .setLngLat([robotPose.x, robotPose.y])
      .addTo(map.current);

    robotMarkerRef.current = robotMarker;

    return () => {
      if (robotMarkerRef.current) {
        robotMarkerRef.current.remove();
        robotMarkerRef.current = null;
      }
    };
  }, [robotPose]);

  React.useEffect(() => {
    if (!map.current || !pathData || pathData.points.length === 0) {
      if (map.current?.getSource("mission-path")) {
        map.current.removeLayer("mission-path-line");
        map.current.removeSource("mission-path");
      }
      return;
    }

    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: pathData.points.map(p => [p.x, p.y]),
      },
    };

    if (map.current.getSource("mission-path")) {
      (map.current.getSource("mission-path") as maplibregl.GeoJSONSource).setData(geojson);
    } else {
      map.current.addSource("mission-path", {
        type: "geojson",
        data: geojson,
      });

      map.current.addLayer({
        id: "mission-path-line",
        type: "line",
        source: "mission-path",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#4a4e69",  
          "line-width": 3,
          "line-opacity": 0.8,
        },
      });
    }

    return () => {
      // Cleanup
      if (map.current?.getSource("mission-path")) {
        map.current.removeLayer("mission-path-line");
        map.current.removeSource("mission-path");
      }
    };
  }, [pathData]);

  const reset2DView = () => {
    if (!map.current || !originalBoundsRef.current) return;
    
    map.current.fitBounds(originalBoundsRef.current, { 
      padding: 20,
      pitch: 0,     
      bearing: 0,    
      duration: 1000,
    });
    
    setShowResetButton(false);
  };

  const switch3DView = () => {
    if (!map.current || !originalBoundsRef.current) return;
    
    map.current.fitBounds(originalBoundsRef.current, { 
      padding: 20,
      pitch: 60,     
      bearing: 0,    
      duration: 1000,
    });
    
    setShowResetButton(false);
  };

  React.useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "2") {
        reset2DView();
      }
      if (e.key === "3") {
        switch3DView();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);

  return (
    <div
      ref={mapRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          background: "rgba(0, 0, 0, 0.8)",
          color: "white",
          padding: "12px 16px",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: "500",
          zIndex: 1000,
          minWidth: 200,
          backdropFilter: "blur(10px)",
        }}
      >
        {robotPose && (
          <div style={{ fontSize: 11, color: "#f8f9fa" }}>
            <div style={{ fontWeight: 600 }}>Robot Position:</div>
            <div>X: {robotPose.x.toFixed(2)}, Y: {robotPose.y.toFixed(2)}, Yaw: {(robotPose.yaw * (180 / Math.PI)).toFixed(1)}°</div>
          </div>
        )}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 20,
          right: 20,
          display: "flex",
          gap: 8,
          zIndex: 1000,
        }}
      >
        <button
          onClick={reset2DView}
          title="2D View (Press 2)"
          style={{
            minWidth: 56,
            height: 40,
            padding: "0 16px",
            background: showResetButton 
              ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
              : "rgba(255, 255, 255, 0.95)",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
            color: showResetButton ? "white" : "#495057",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            transition: "all 0.3s ease",
            opacity: showResetButton ? 1 : 0.85,
            transform: showResetButton ? "scale(1)" : "scale(0.98)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.05) translateY(-2px)";
            e.currentTarget.style.boxShadow = showResetButton 
              ? "0 4px 16px rgba(102, 126, 234, 0.5)"
              : "0 4px 12px rgba(0,0,0,0.2)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = showResetButton ? "scale(1)" : "scale(0.98)";
            e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
          }}
        >
          2D
        </button>

        <button
          onClick={switch3DView}
          title="3D View (Press 3)"
          style={{
            minWidth: 56,
            height: 40,
            padding: "0 16px",
            background: "rgba(255, 255, 255, 0.95)",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 600,
            color: "#495057",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.05) translateY(-2px)";
            e.currentTarget.style.background = "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)";
            e.currentTarget.style.color = "white";
            e.currentTarget.style.boxShadow = "0 4px 16px rgba(240, 147, 251, 0.5)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.95)";
            e.currentTarget.style.color = "#495057";
            e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
          }}
        >
          3D
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 70,
          right: 20,
          background: "rgba(0, 0, 0, 0.8)",
          color: "white",
          padding: "8px 12px",
          borderRadius: 6,
          fontSize: 11,
          backdropFilter: "blur(10px)",
          opacity: 0,
          transition: "opacity 0.3s ease",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
        className="view-shortcuts-hint"
      >
        <div><strong>2</strong> - 2D View | <strong>3</strong> - 3D View</div>
      </div>

      {/* CSS for shortcuts hint hover effect */}
      <style>{`
        div:has(> button):hover .view-shortcuts-hint {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}