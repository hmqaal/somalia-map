"use client";

import { useEffect, useMemo, useState } from "react";
import MapboxMap from "react-map-gl/mapbox";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, GeoJsonLayer } from "@deck.gl/layers";
import Papa from "papaparse";
import "mapbox-gl/dist/mapbox-gl.css";

type Settlement = {
  OBJECTID: number;
  SETTLEMENT: string;
  REG_NAME: string;
  DIST_NAME: string;
  X: number;
  Y: number;
  house_count: number;
};

type TribeRow = {
  OBJECTID: number;
  tribe_level: number;
  percent: number;
  Tribe_name: string;
};

function colorForName(name: string): [number, number, number, number] {
  if (!name || name.toLowerCase() === "unknown") return [130, 130, 130, 150];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return [
    80 + Math.abs(hash % 150),
    80 + Math.abs((hash >> 8) % 150),
    80 + Math.abs((hash >> 16) % 150),
    180,
  ];
}

export default function Home() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [tribes, setTribes] = useState<TribeRow[]>([]);
  const [adm2, setAdm2] = useState<any>(null);

  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [tribeLevel, setTribeLevel] = useState("1");
  const [selectedTribe, setSelectedTribe] = useState("All");
  const [householdSize, setHouseholdSize] = useState(6.7);
  const [hoverInfo, setHoverInfo] = useState<any>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const [viewState, setViewState] = useState({
    longitude: 45.3,
    latitude: 5.2,
    zoom: 5.3,
    pitch: 0,
    bearing: 0,
  });

  useEffect(() => {
    Papa.parse("/data/somalia_house_counts_by_settlement.csv", {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (result) => setSettlements(result.data as Settlement[]),
    });

    Papa.parse("/data/tribe_composition.csv", {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (result) => {
        setTribes(
          (result.data as TribeRow[]).filter(
            (d) => d.Tribe_name && d.tribe_level !== null && d.tribe_level !== undefined
          )
        );
      },
    });

    fetch("/data/geoBoundaries-SOM-ADM2_simplified.geojson")
      .then((r) => r.json())
      .then(setAdm2);
  }, []);

  const regions = useMemo(
    () => Array.from(new Set(settlements.map((d) => d.REG_NAME).filter(Boolean))).sort(),
    [settlements]
  );

  const districts = useMemo(() => {
    const rows =
      selectedRegions.length === 0
        ? settlements
        : settlements.filter((d) => selectedRegions.includes(d.REG_NAME));

    return Array.from(new Set(rows.map((d) => d.DIST_NAME).filter(Boolean))).sort();
  }, [settlements, selectedRegions]);

  const tribeBySettlement = useMemo(() => {
    const map = new globalThis.Map<number, TribeRow[]>();
    for (const t of tribes) {
      const id = Number(t.OBJECTID);
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(t);
    }
    return map;
  }, [tribes]);

  const dominantTribe = (objectId: number) => {
    const rows = (tribeBySettlement.get(Number(objectId)) || []).filter(
      (t) => String(t.tribe_level) === tribeLevel
    );

    if (rows.length === 0) return "Unknown";

    return rows.sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0))[0].Tribe_name;
  };

  const tribeNames = useMemo(() => {
    const names = new Set<string>();

    for (const s of settlements) {
      const regionOk = selectedRegions.length === 0 || selectedRegions.includes(s.REG_NAME);
      const districtOk = selectedDistricts.length === 0 || selectedDistricts.includes(s.DIST_NAME);
      if (!regionOk || !districtOk) continue;

      names.add(dominantTribe(Number(s.OBJECTID)));
    }

    return ["All", ...Array.from(names).sort()];
  }, [settlements, selectedRegions, selectedDistricts, tribeLevel, tribeBySettlement]);

  const filtered = useMemo(() => {
    return settlements.filter((d) => {
      const regionOk = selectedRegions.length === 0 || selectedRegions.includes(d.REG_NAME);
      const districtOk = selectedDistricts.length === 0 || selectedDistricts.includes(d.DIST_NAME);
      const tribe = dominantTribe(Number(d.OBJECTID));
      const tribeOk = selectedTribe === "All" || tribe === selectedTribe;

      return regionOk && districtOk && tribeOk;
    });
  }, [settlements, selectedRegions, selectedDistricts, selectedTribe, tribeLevel, tribeBySettlement]);

  useEffect(() => {
    if (filtered.length === 0) return;

    const lons = filtered.map((d) => Number(d.X)).filter(Number.isFinite);
    const lats = filtered.map((d) => Number(d.Y)).filter(Number.isFinite);
    if (!lons.length || !lats.length) return;

    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const maxDelta = Math.max(maxLon - minLon, maxLat - minLat, 0.05);

    setViewState((prev) => ({
      ...prev,
      longitude: (minLon + maxLon) / 2,
      latitude: (minLat + maxLat) / 2,
      zoom: Math.max(5, Math.min(11, 8 - Math.log2(maxDelta))),
    }));
  }, [selectedRegions, selectedDistricts, selectedTribe, tribeLevel]);

  const totalHouses = filtered.reduce((sum, d) => sum + Number(d.house_count || 0), 0);
  const estimatedPopulation = Math.round(totalHouses * householdSize);

  const toggleRegion = (r: string) => {
    setSelectedRegions((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
    setSelectedDistricts([]);
    setSelectedTribe("All");
  };

  const toggleDistrict = (d: string) => {
    setSelectedDistricts((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
    setSelectedTribe("All");
  };

  const layers = [
    adm2 &&
      new GeoJsonLayer({
        id: "adm2",
        data: adm2,
        stroked: true,
        filled: true,
        getFillColor: [0, 0, 0, 1],
        getLineColor: [80, 80, 80, 150],
        getLineWidth: 1,
        lineWidthMinPixels: 1,
      }),

    new ScatterplotLayer({
      id: "settlements",
      data: filtered,
      getPosition: (d: Settlement) => [Number(d.X), Number(d.Y)],
      getRadius: (d: Settlement) =>
        Math.max(80, Math.sqrt(Number(d.house_count || 0)) * 45),
      radiusUnits: "meters",
      getFillColor: (d: Settlement) => colorForName(dominantTribe(Number(d.OBJECTID))),
      getLineColor: [255, 255, 255],
      lineWidthMinPixels: 1,
      pickable: true,
      onHover: (info) => setHoverInfo(info.object ? info : null),
    }),
  ].filter(Boolean);

  const FilterContent = () => (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Somalia House Counts</h1>

      <div className="md:hidden">
        <div className="font-semibold text-sm mb-2">Regions</div>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto border rounded p-2">
          <button
            className={`px-3 py-1 rounded border text-sm ${
              selectedRegions.length === 0 ? "bg-black text-white" : "bg-white"
            }`}
            onClick={() => {
              setSelectedRegions([]);
              setSelectedDistricts([]);
              setSelectedTribe("All");
            }}
          >
            All
          </button>
          {regions.map((r) => (
            <button
              key={r}
              className={`px-3 py-1 rounded border text-sm ${
                selectedRegions.includes(r) ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => toggleRegion(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="md:hidden">
        <div className="font-semibold text-sm mb-2">Districts</div>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto border rounded p-2">
          <button
            className={`px-3 py-1 rounded border text-sm ${
              selectedDistricts.length === 0 ? "bg-black text-white" : "bg-white"
            }`}
            onClick={() => {
              setSelectedDistricts([]);
              setSelectedTribe("All");
            }}
          >
            All
          </button>
          {districts.map((d) => (
            <button
              key={d}
              className={`px-3 py-1 rounded border text-sm ${
                selectedDistricts.includes(d) ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => toggleDistrict(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="font-semibold text-sm">Tribe Level</label>
        <select
          className="w-full border rounded p-2 mt-1"
          value={tribeLevel}
          onChange={(e) => {
            setTribeLevel(e.target.value);
            setSelectedTribe("All");
          }}
        >
          <option value="0">Tribe Level 0</option>
          <option value="1">Tribe Level 1</option>
          <option value="2">Tribe Level 2</option>
          <option value="3">Tribe Level 3</option>
          <option value="4">Tribe Level 4</option>
          <option value="5">Tribe Level 5</option>
        </select>
      </div>

      <div>
        <div className="font-semibold text-sm mb-2">Tribe Names</div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {tribeNames.map((name) => (
            <button
              key={name}
              className={`w-full flex items-center gap-2 px-2 py-1 rounded border text-sm ${
                selectedTribe === name ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => setSelectedTribe(name)}
            >
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{
                  backgroundColor:
                    name === "All" ? "black" : `rgba(${colorForName(name).join(",")})`,
                }}
              />
              <span>{name}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold">
          Avg Household Size: {householdSize.toFixed(1)}
        </div>
        <input
          type="range"
          min="2"
          max="7"
          step="0.1"
          value={householdSize}
          onChange={(e) => setHouseholdSize(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-100 rounded p-2">
          <div className="text-xs text-gray-500">Settlements</div>
          <div className="font-bold">{filtered.length.toLocaleString()}</div>
        </div>

        <div className="bg-gray-100 rounded p-2">
          <div className="text-xs text-gray-500">Houses</div>
          <div className="font-bold">{totalHouses.toLocaleString()}</div>
        </div>

        <div className="bg-gray-100 rounded p-2">
          <div className="text-xs text-gray-500">Population</div>
          <div className="font-bold">{estimatedPopulation.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );

  return (
    <main className="h-screen w-screen relative">
      <div className="hidden md:block absolute top-0 left-0 right-0 z-20 bg-white shadow p-3 space-y-2">
        <div className="font-bold">Regions</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            className={`px-3 py-1 rounded border text-sm whitespace-nowrap ${
              selectedRegions.length === 0 ? "bg-black text-white" : "bg-white"
            }`}
            onClick={() => {
              setSelectedRegions([]);
              setSelectedDistricts([]);
              setSelectedTribe("All");
            }}
          >
            All
          </button>

          {regions.map((r) => (
            <button
              key={r}
              className={`px-3 py-1 rounded border text-sm whitespace-nowrap ${
                selectedRegions.includes(r) ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => toggleRegion(r)}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="font-bold">Districts</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            className={`px-3 py-1 rounded border text-sm whitespace-nowrap ${
              selectedDistricts.length === 0 ? "bg-black text-white" : "bg-white"
            }`}
            onClick={() => {
              setSelectedDistricts([]);
              setSelectedTribe("All");
            }}
          >
            All
          </button>

          {districts.map((d) => (
            <button
              key={d}
              className={`px-3 py-1 rounded border text-sm whitespace-nowrap ${
                selectedDistricts.includes(d) ? "bg-black text-white" : "bg-white"
              }`}
              onClick={() => toggleDistrict(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <button
        className="md:hidden absolute top-3 left-3 z-30 bg-white shadow rounded-lg px-4 py-2 font-semibold"
        onClick={() => setMobileFiltersOpen(true)}
      >
        Filters
      </button>

      <div className="hidden md:block absolute top-36 left-4 z-10 bg-white rounded-xl shadow p-4 w-80 max-h-[78vh] overflow-y-auto">
        <FilterContent />
      </div>

      {mobileFiltersOpen && (
        <div className="md:hidden absolute inset-0 z-40 bg-black/30">
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-4 max-h-[82vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
              <div className="font-bold text-lg">Filters</div>
              <button
                className="text-2xl"
                onClick={() => setMobileFiltersOpen(false)}
              >
                ×
              </button>
            </div>
            <FilterContent />
          </div>
        </div>
      )}

      {hoverInfo && (
        <div
          className="absolute z-30 bg-white rounded shadow p-3 text-sm pointer-events-none"
          style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}
        >
          <div className="font-bold">{hoverInfo.object.SETTLEMENT}</div>
          <div>Region: {hoverInfo.object.REG_NAME}</div>
          <div>District: {hoverInfo.object.DIST_NAME}</div>
          <div>Houses: {Number(hoverInfo.object.house_count).toLocaleString()}</div>
          <div>
            Est. Population:{" "}
            {Math.round(Number(hoverInfo.object.house_count) * householdSize).toLocaleString()}
          </div>
          <div>Tribe: {dominantTribe(Number(hoverInfo.object.OBJECTID))}</div>
        </div>
      )}

      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState }: any) => setViewState(viewState)}
        controller
        layers={layers as any}
      >
        <MapboxMap
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/light-v11"
        />
      </DeckGL>
    </main>
  );
}