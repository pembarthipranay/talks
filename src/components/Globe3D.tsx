import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Globe3DProps {
  interactive?: boolean;
  pulseCount?: number;
}

export const Globe3D: React.FC<Globe3DProps> = ({ interactive = true, pulseCount = 8 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameId = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Detect reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Scene setup
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 18);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // 1. Core Sphere with Deep Blue/Charcoal Material and Subtle Grid
    const radius = 6.2;
    const sphereGeo = new THREE.SphereGeometry(radius, 64, 64);
    const sphereMat = new THREE.MeshPhongMaterial({
      color: 0x0a0c16,
      emissive: 0x050811,
      specular: 0x8b5cf6,
      shininess: 25,
      transparent: true,
      opacity: 0.95,
    });
    const coreSphere = new THREE.Mesh(sphereGeo, sphereMat);
    globeGroup.add(coreSphere);

    // 2. Wireframe / Longitude-Latitude Dot Grid
    const wireGeo = new THREE.SphereGeometry(radius + 0.05, 36, 18);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x312e81,
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    });
    const wireSphere = new THREE.Mesh(wireGeo, wireMat);
    globeGroup.add(wireSphere);

    // 3. Dot Landmass Simulation (Generates realistic distribution of surface points)
    const pointsCount = 1800;
    const positions = new Float32Array(pointsCount * 3);
    const colors = new Float32Array(pointsCount * 3);

    const colorViolet = new THREE.Color(0xa78bfa);
    const colorCyan = new THREE.Color(0x22d3ee);
    const colorDim = new THREE.Color(0x374151);

    for (let i = 0; i < pointsCount; i++) {
      // Golden spiral distribution
      const phi = Math.acos(1 - 2 * (i + 0.5) / pointsCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;

      const r = radius + 0.08;
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Color variation
      const mixRatio = Math.random();
      const chosenColor = mixRatio > 0.8 ? colorCyan : mixRatio > 0.5 ? colorViolet : colorDim;
      colors[i * 3] = chosenColor.r;
      colors[i * 3 + 1] = chosenColor.g;
      colors[i * 3 + 2] = chosenColor.b;
    }

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pointsMat = new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
    });
    const particlePoints = new THREE.Points(pointsGeo, pointsMat);
    globeGroup.add(particlePoints);

    // 4. Glowing Atmosphere Rim
    const atmosphereGeo = new THREE.SphereGeometry(radius + 0.8, 48, 48);
    const atmosphereMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.2);
          gl_FragColor = vec4(0.55, 0.36, 0.98, 1.0) * intensity * 0.9;
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
    });
    const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
    globeGroup.add(atmosphere);

    // 5. Representative City / Node Locations with Beacons
    const cityCoords = [
      { lat: 40.7128, lng: -74.006 }, // New York
      { lat: 51.5074, lng: -0.1278 },  // London
      { lat: 35.6762, lng: 139.6503 }, // Tokyo
      { lat: -33.8688, lng: 151.2093 },// Sydney
      { lat: 28.6139, lng: 77.209 },   // New Delhi
      { lat: -23.5505, lng: -46.6333 },// São Paulo
      { lat: 1.3521, lng: 103.8198 },  // Singapore
      { lat: 25.2048, lng: 55.2708 },  // Dubai
      { lat: 37.7749, lng: -122.4194 },// San Francisco
      { lat: 48.8566, lng: 2.3522 },   // Paris
      { lat: -1.2921, lng: 36.8219 },  // Nairobi
    ];

    function latLngToVector3(lat: number, lng: number, r: number): THREE.Vector3 {
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (lng + 180) * (Math.PI / 180);
      return new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
    }

    const beaconGroup = new THREE.Group();
    globeGroup.add(beaconGroup);

    cityCoords.forEach((city) => {
      const pos = latLngToVector3(city.lat, city.lng, radius + 0.1);
      const beaconGeo = new THREE.SphereGeometry(0.12, 16, 16);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
      beaconMesh.position.copy(pos);
      beaconGroup.add(beaconMesh);
    });

    // 6. Dynamic Connection Arcs between pairs of cities
    const arcCurves: { curve: THREE.QuadraticBezierCurve3; lineMesh: THREE.Line; pulseMesh: THREE.Mesh }[] = [];
    const arcPairs = [
      [0, 1], // NY to London
      [1, 2], // London to Tokyo
      [2, 3], // Tokyo to Sydney
      [0, 8], // NY to SF
      [1, 7], // London to Dubai
      [7, 4], // Dubai to Delhi
      [4, 6], // Delhi to Singapore
      [0, 5], // NY to São Paulo
    ];

    const arcMat = new THREE.LineBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0.35,
    });

    const pulseGeo = new THREE.SphereGeometry(0.16, 12, 12);
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });

    arcPairs.forEach(([idxA, idxB]) => {
      const vA = latLngToVector3(cityCoords[idxA].lat, cityCoords[idxA].lng, radius + 0.12);
      const vB = latLngToVector3(cityCoords[idxB].lat, cityCoords[idxB].lng, radius + 0.12);

      // Midpoint pulled outward
      const mid = new THREE.Vector3().addVectors(vA, vB).multiplyScalar(0.5);
      const dist = vA.distanceTo(vB);
      mid.normalize().multiplyScalar(radius + Math.max(1.0, dist * 0.3));

      const curve = new THREE.QuadraticBezierCurve3(vA, mid, vB);
      const points = curve.getPoints(40);
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const lineMesh = new THREE.Line(geometry, arcMat);
      globeGroup.add(lineMesh);

      const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      globeGroup.add(pulseMesh);

      arcCurves.push({ curve, lineMesh, pulseMesh });
    });

    // 7. Ambient Lighting and Spot Lights
    const ambientLight = new THREE.AmbientLight(0x1e1b4b, 1.6);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x818cf8, 2.2);
    dirLight1.position.set(15, 12, 15);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x06b6d4, 1.4);
    dirLight2.position.set(-15, -10, -10);
    scene.add(dirLight2);

    // Tilt globe slightly on axis (like Earth's 23.5 degrees)
    globeGroup.rotation.z = 0.25;

    // Mouse Parallax & Dragging
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let targetRotationX = 0;
    let targetRotationY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (!interactive) return;
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!interactive) return;
      if (isDragging) {
        const deltaX = e.clientX - prevMouseX;
        const deltaY = e.clientY - prevMouseY;
        targetRotationY += deltaX * 0.005;
        targetRotationX += deltaY * 0.005;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
      }
    };

    const onPointerUp = () => {
      isDragging = false;
    };

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // Responsive Resize Observer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
        }
      }
    });
    resizeObserver.observe(container);

    // Animation Loop
    const startTime = performance.now();
    let lastTime = startTime;

    const animate = () => {
      const now = performance.now();
      const delta = (now - lastTime) * 0.001;
      const time = (now - startTime) * 0.001;
      lastTime = now;

      // Continuous slow rotation if not dragging
      if (!prefersReducedMotion) {
        targetRotationY += 0.0018;
      }

      // Smooth dampening
      globeGroup.rotation.y += (targetRotationY - globeGroup.rotation.y) * 0.05;
      globeGroup.rotation.x += (targetRotationX - globeGroup.rotation.x) * 0.05;

      // Animate travelling light pulses along connection arcs
      arcCurves.forEach(({ curve, pulseMesh }, index) => {
        if (prefersReducedMotion) {
          pulseMesh.visible = false;
          return;
        }
        const speed = 0.35 + (index % 3) * 0.15;
        const progress = (time * speed + index * 0.25) % 1;
        const point = curve.getPoint(progress);
        pulseMesh.position.copy(point);
        const scale = Math.sin(progress * Math.PI) * 1.3 + 0.4;
        pulseMesh.scale.set(scale, scale, scale);
      });

      renderer.render(scene, camera);
      animFrameId.current = requestAnimationFrame(animate);
    };

    animate();

    // Cleanup
    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      resizeObserver.disconnect();

      if (container.contains(dom)) {
        container.removeChild(dom);
      }

      sphereGeo.dispose();
      sphereMat.dispose();
      wireGeo.dispose();
      wireMat.dispose();
      pointsGeo.dispose();
      pointsMat.dispose();
      atmosphereGeo.dispose();
      atmosphereMat.dispose();
      pulseGeo.dispose();
      pulseMat.dispose();
      renderer.dispose();
    };
  }, [interactive, pulseCount]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full pointer-events-auto cursor-grab active:cursor-grabbing overflow-hidden"
      aria-label="Interactive 3D Earth visualization showing global random talk connections"
    />
  );
};
