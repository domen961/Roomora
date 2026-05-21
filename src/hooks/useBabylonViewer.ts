import { useCallback, useEffect, useRef, useState } from "react";
import * as BABYLON from "@babylonjs/core";
// Registers all available loaders: glTF (GLB/GLTF), OBJ, STL, SPLAT
// Note: FBX is not supported in @babylonjs/loaders v7
import "@babylonjs/loaders";

const SNAPSHOT_ANGLES = [
  { label: "perspective", alpha: -Math.PI / 4,  beta: Math.PI / 3   },
  { label: "front",       alpha: -Math.PI / 2,  beta: Math.PI / 2.2 },
  { label: "side",        alpha: 0,             beta: Math.PI / 2.2 },
  { label: "back",        alpha:  Math.PI / 2,  beta: Math.PI / 2.2 },
] as const;

export interface BabylonViewer {
  processModel: (file: File) => Promise<string[]>;
  isReady: boolean;
}

export function useBabylonViewer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): BabylonViewer {
  const engineRef = useRef<BABYLON.Engine | null>(null);
  const sceneRef  = useRef<BABYLON.Scene  | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new BABYLON.Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });

    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.09, 0.09, 0.09, 1);

    const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.8;
    const dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-1, -2, -1), scene);
    dir.intensity = 0.6;

    const camera = new BABYLON.ArcRotateCamera(
      "cam", -Math.PI / 2, Math.PI / 3, 8, BABYLON.Vector3.Zero(), scene,
    );
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 50;

    engine.runRenderLoop(() => scene.render());

    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);

    engineRef.current = engine;
    sceneRef.current  = scene;
    setIsReady(true);

    return () => {
      window.removeEventListener("resize", onResize);
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
      engineRef.current = null;
      sceneRef.current  = null;
      setIsReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const processModel = useCallback(async (file: File): Promise<string[]> => {
    const scene = sceneRef.current;
    if (!scene) throw new Error("Babylon engine not ready");

    // Dispose previous meshes
    scene.meshes.slice().forEach((m) => m.dispose());

    const ext       = file.name.split(".").pop()?.toLowerCase() ?? "glb";
    const objectUrl = URL.createObjectURL(file);

    await BABYLON.SceneLoader.ImportMeshAsync("", "", objectUrl, scene, null, `.${ext}`);
    URL.revokeObjectURL(objectUrl);

    // Auto-fit camera to bounding box
    const meshes = scene.meshes.filter((m) => m.getTotalVertices() > 0);
    if (meshes.length > 0) {
      const bounds = scene.getWorldExtends();
      const size   = bounds.max.subtract(bounds.min);
      const center = bounds.min.add(size.scale(0.5));
      const maxDim = Math.max(size.x, size.y, size.z);
      const camera = scene.cameras[0] as BABYLON.ArcRotateCamera;
      camera.target = center;
      camera.radius = maxDim * 2.2;
    }

    // Generate 4 angle snapshots
    const camera = scene.cameras[0] as BABYLON.ArcRotateCamera;
    const engine = scene.getEngine();
    const snapshots: string[] = [];

    for (const angle of SNAPSHOT_ANGLES) {
      camera.alpha = angle.alpha;
      camera.beta  = angle.beta;
      scene.render();
      // Small delay to let GPU flush
      await new Promise<void>((r) => setTimeout(r, 50));
      const dataUrl = await BABYLON.Tools.CreateScreenshotAsync(
        engine, camera, { width: 1024, height: 1024 },
      );
      snapshots.push(dataUrl);
    }

    // Clean up loaded meshes for next use
    scene.meshes.slice().forEach((m) => m.dispose());

    return snapshots; // [perspective, front, side, back]
  }, []);

  return { processModel, isReady };
}
