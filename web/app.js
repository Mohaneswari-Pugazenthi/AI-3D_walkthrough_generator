import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ----------------------------------------------------
// Runtime session support (only addition for the upload feature)
// ----------------------------------------------------
// viewer.html?session=<id> points the viewer at a runtime-generated
// layout.json/OBJ instead of the fixed output/ sample data. With no
// session param (or an invalid one), the original fixed-output behavior
// is unchanged. Everything below this block is exactly as before.
const urlParams = new URLSearchParams(window.location.search);
const rawSessionId = urlParams.get("session");
const sessionId = rawSessionId && /^[a-zA-Z0-9_-]+$/.test(rawSessionId) ? rawSessionId : null;

const LAYOUT_URL = sessionId
    ? `../runtime/${sessionId}/layout.json`
    : "../output/layout.json";

const OBJ_URL = sessionId
    ? `../runtime/${sessionId}/tenix_floorplan.obj`
    : "../output/tenix_floorplan.obj";

const container = document.getElementById("scene-container");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");
const errorPanel = document.getElementById("error-panel");
const errorMessage = document.getElementById("error-message");
const clickOverlay = document.getElementById("click-to-start");
const pipelineToggle = document.getElementById("pipeline-toggle");
const pipelineContent = document.getElementById("pipeline-content");

let scene;
let camera;
let renderer;
let fpControls;
let orbitControls;
let model;

const clock = new THREE.Clock();

const keys = {
    forward: false,
    backward: false,
    left: false,
    right: false
};
const MOVE_SPEED = 3.0;
const TURN_SPEED = 1.8;
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.35;


let mode = "first-person";
let spawnPosition = new THREE.Vector3();

const colliders = [];

// ----------------------------------------------------
// Scene
// ----------------------------------------------------

scene = new THREE.Scene();
scene.background = new THREE.Color(0x11151c);

camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.05,
    200
);

camera.position.set(0, EYE_HEIGHT, 0);

renderer = new THREE.WebGLRenderer({
    antialias: true
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

container.appendChild(renderer.domElement);

// ----------------------------------------------------
// Lighting
// ----------------------------------------------------

const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0);
directionalLight.position.set(5, 12, 5);
directionalLight.castShadow = true;
scene.add(directionalLight);

// Additional fill light
const fillLight = new THREE.DirectionalLight(0x88aaff, 0.5);
fillLight.position.set(-8, 6, -8);
scene.add(fillLight);

// ----------------------------------------------------
// Ground reference
// ----------------------------------------------------

const grid = new THREE.GridHelper(40, 40, 0x555555, 0x333333);
grid.position.y = 0;
scene.add(grid);

// ----------------------------------------------------
// Controls
// ----------------------------------------------------

fpControls = new PointerLockControls(camera, document.body);
fpControls.pointerSpeed = 0.5;
orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.enablePan = true;
orbitControls.enableZoom = true;
orbitControls.enabled = false;

// Click-to-start
clickOverlay.addEventListener("click", () => {
    if (mode === "first-person") {
        fpControls.lock();
    }
});

fpControls.addEventListener("lock", () => {
    clickOverlay.style.display = "none";
});

fpControls.addEventListener("unlock", () => {
    if (mode === "first-person") {
        clickOverlay.style.display = "flex";
    }
});

// ----------------------------------------------------
// Keyboard
// ----------------------------------------------------

document.addEventListener("keydown", (event) => {
    switch (event.code) {
        case "KeyW":
            keys.forward = true;
            break;
        case "KeyS":
            keys.backward = true;
            break;
        case "KeyA":
            keys.left = true;
            break;
        case "KeyD":
            keys.right = true;
            break;
        case "KeyR":
            resetPosition();
            break;
        case "Digit1":
            setFirstPersonMode();
            break;
        case "Digit2":
            setTopViewMode();
            break;
        case "Digit3":
            setOrbitMode();
            break;
    }
});

document.addEventListener("keyup", (event) => {
    switch (event.code) {
        case "KeyW":
            keys.forward = false;
            break;
        case "KeyS":
            keys.backward = false;
            break;
        case "KeyA":
            keys.left = false;
            break;
        case "KeyD":
            keys.right = false;
            break;
    }
});

// ----------------------------------------------------
// Pipeline panel
// ----------------------------------------------------

pipelineToggle.addEventListener("click", () => {
    const expanded = pipelineToggle.getAttribute("aria-expanded") === "true";

    pipelineToggle.setAttribute("aria-expanded", String(!expanded));
    pipelineContent.hidden = expanded;
});

// ----------------------------------------------------
// Load OBJ
// ----------------------------------------------------

function loadModel() {
    const loader = new OBJLoader();

    loading.style.display = "flex";
    loadingText.textContent = "Loading TENIX floorplan model...";

    loader.load(
        OBJ_URL,

        async (object) => {
            model = object;

            console.log("TENIX OBJ loaded successfully.");

            // The Phase 3 OBJ contains room-patch geometry that can appear as
            // large triangulated surfaces in browsers. Keep the OBJ loaded as
            // the generated 3D artifact, but use layout.json to build a clean
            // walkthrough visualization for the browser MVP.
            model.visible = false;

            await buildCleanSceneFromLayout();

            loading.style.display = "none";
        },

        (xhr) => {
            if (xhr.total) {
                const percent = Math.round(
                    (xhr.loaded / xhr.total) * 100
                );

                loadingText.textContent =
                    `Loading TENIX floorplan model... ${percent}%`;
            }
        },

        (error) => {
            console.error("OBJ loading error:", error);

            loading.style.display = "none";
            errorPanel.hidden = false;

            errorMessage.textContent =
                "Could not load output/tenix_floorplan.obj. " +
                "Make sure the local Python server is running from the project root.";
        }
    );
}

// ----------------------------------------------------
// Clean browser visualization from layout.json
// ----------------------------------------------------

async function buildCleanSceneFromLayout() {
    try {
        const response = await fetch(LAYOUT_URL);

        if (!response.ok) {
            throw new Error(`layout.json returned HTTP ${response.status}`);
        }

        const layout = await response.json();

        const w = layout.metadata.image_width;
        const h = layout.metadata.image_height;

        // EXACT same scale used by Phase 3 geometry.py
        const maxExtent = 15.0;
        const s = maxExtent / Math.max(w, h);

        const wallThickness = 0.2;
        const wallHeight = 2.8;

        // Floor dimensions in world units.
        const floorWidth = w * s;
        const floorDepth = h * s;

        // Main floor.
        const floorGeometry = new THREE.PlaneGeometry(
            floorWidth,
            floorDepth
        );

        const floorMaterial = new THREE.MeshStandardMaterial({
            color: 0x252a32,
            roughness: 0.92,
            metalness: 0.0
        });

        const floor = new THREE.Mesh(
            floorGeometry,
            floorMaterial
        );

        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, 0, 0);
        floor.receiveShadow = true;
        scene.add(floor);

        // Clean detected-wall visualization.
        const wallMaterial = new THREE.MeshStandardMaterial({
            color: 0xd9dde3,
            roughness: 0.78,
            metalness: 0.03
        });

        let wallCount = 0;

        for (const wall of layout.walls || []) {
            const [x0, y0] = wall.start;
            const [x1, y1] = wall.end;

            const xStart = (x0 - w / 2) * s;
            const zStart = (y0 - h / 2) * s;

            const xEnd = (x1 - w / 2) * s;
            const zEnd = (y1 - h / 2) * s;

            const dx = xEnd - xStart;
            const dz = zEnd - zStart;
            const length = Math.hypot(dx, dz);

            if (length < 0.01) {
                continue;
            }

            const wallGeometry = new THREE.BoxGeometry(
                length,
                wallHeight,
                wallThickness
            );

            const wallMesh = new THREE.Mesh(
                wallGeometry,
                wallMaterial
            );

            wallMesh.position.set(
                (xStart + xEnd) / 2,
                wallHeight / 2,
                (zStart + zEnd) / 2
            );

            // BoxGeometry's long axis is X. Rotate it to the detected segment.
            wallMesh.rotation.y = -Math.atan2(dz, dx);

            wallMesh.castShadow = true;
            wallMesh.receiveShadow = true;

            scene.add(wallMesh);
            wallCount++;
        }

        // Add a subtle boundary around the generated floor.
        const boundaryMaterial = new THREE.LineBasicMaterial({
            color: 0x4b5563
        });

        const boundaryPoints = [
            new THREE.Vector3(-floorWidth / 2, 0.015, -floorDepth / 2),
            new THREE.Vector3(floorWidth / 2, 0.015, -floorDepth / 2),
            new THREE.Vector3(floorWidth / 2, 0.015, floorDepth / 2),
            new THREE.Vector3(-floorWidth / 2, 0.015, floorDepth / 2),
            new THREE.Vector3(-floorWidth / 2, 0.015, -floorDepth / 2)
        ];

        const boundaryGeometry =
            new THREE.BufferGeometry().setFromPoints(boundaryPoints);

        const boundary = new THREE.Line(
            boundaryGeometry,
            boundaryMaterial
        );

        scene.add(boundary);

        // Build collision boxes from the same wall data.
        await buildCollidersFromLayout();

        // Spawn near the center of the generated floor.
        spawnPosition.set(0, EYE_HEIGHT, 0);

        // If the exact center is inside a detected wall, try nearby points.
        const spawnCandidates = [
            new THREE.Vector3(-5, EYE_HEIGHT, -5),
            new THREE.Vector3(5, EYE_HEIGHT, -5),
            new THREE.Vector3(-5, EYE_HEIGHT, 5),
            new THREE.Vector3(5, EYE_HEIGHT, 5),
            new THREE.Vector3(-3, EYE_HEIGHT, -3),
            new THREE.Vector3(3, EYE_HEIGHT, -3),
            new THREE.Vector3(-3, EYE_HEIGHT, 3),
            new THREE.Vector3(3, EYE_HEIGHT, 3),
            new THREE.Vector3(0, EYE_HEIGHT, 0)
      ];
        

        for (const candidate of spawnCandidates) {
            if (canMoveTo(candidate)) {
                spawnPosition.copy(candidate);
                break;
            }
        }

        camera.position.copy(spawnPosition);
        camera.lookAt(
            new THREE.Vector3(
                spawnPosition.x,
                EYE_HEIGHT,
                spawnPosition.z - 3
            )
        );

        orbitControls.target.set(0, 1, 0);
        orbitControls.update();

        console.log(
            `TENIX clean browser scene created: ${wallCount} walls.`
        );
        console.log(
            `Floor size: ${floorWidth.toFixed(2)}m x ${floorDepth.toFixed(2)}m`
        );

    } catch (error) {
        console.error(
            "Could not build clean scene from layout.json:",
            error
        );

        errorPanel.hidden = false;
        errorMessage.textContent =
            "Could not load output/layout.json. " +
            "Make sure the local Python server is running from the project root.";
    }
}


// ----------------------------------------------------
// Materials
// ----------------------------------------------------

function applyMaterials(object) {
    object.traverse((child) => {
        if (!child.isMesh) {
            return;
        }

        const identifiers = [
            child.name,
            child.parent ? child.parent.name : "",
            child.userData ? child.userData.name : ""
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        // Hide the Phase 3 room-patch geometry.
        // These patches are visualization surfaces and can
        // produce large triangulated polygons in the viewer.
        if (identifiers.includes("room")) {
            child.visible = false;
            return;
        }

        child.visible = true;

        let material;

        if (identifiers.includes("wall")) {
            material = new THREE.MeshStandardMaterial({
                color: 0xd7d7d7,
                roughness: 0.8,
                metalness: 0.05
            });
        } else if (identifiers.includes("door")) {
            material = new THREE.MeshStandardMaterial({
                color: 0x9b6b43,
                roughness: 0.7,
                metalness: 0.05
            });
        } else if (identifiers.includes("floor")) {
            material = new THREE.MeshStandardMaterial({
                color: 0x303640,
                roughness: 0.9,
                metalness: 0.0,
                side: THREE.DoubleSide
            });
        } else {
            material = new THREE.MeshStandardMaterial({
                color: 0xb0b0b0,
                roughness: 0.8,
                side: THREE.DoubleSide
            });
        }

        child.material = material;
        child.castShadow = true;
        child.receiveShadow = true;
    });
}

// ----------------------------------------------------
// Simple wall collision
// ----------------------------------------------------

async function buildCollidersFromLayout() {
    colliders.length = 0;

    try {
        const response = await fetch(LAYOUT_URL);

        if (!response.ok) {
            throw new Error(`layout.json returned HTTP ${response.status}`);
        }

        const layout = await response.json();

        const w = layout.metadata.image_width;
        const h = layout.metadata.image_height;

        // EXACT same scale used by Phase 3 geometry.py
        const maxExtent = 15.0;
        const s = maxExtent / Math.max(w, h);

        const wallThickness = 0.2;
        const wallHeight = 2.8;

        for (const wall of layout.walls || []) {
            const [x0, y0] = wall.start;
            const [x1, y1] = wall.end;

            // EXACT same transformation as geometry.py:
            // (x - w/2) * s, (y - h/2) * s
            const p1 = new THREE.Vector2(
                (x0 - w / 2) * s,
                (y0 - h / 2) * s
            );

            const p2 = new THREE.Vector2(
                (x1 - w / 2) * s,
                (y1 - h / 2) * s
            );

            const dx = p2.x - p1.x;
            const dz = p2.y - p1.y;
            const length = Math.hypot(dx, dz);

            if (length < 0.001) {
                continue;
            }

            // Normal to wall segment.
            const nx = -dz / length;
            const nz = dx / length;

            const halfThickness = wallThickness / 2;

            const minX = Math.min(p1.x, p2.x) - Math.abs(nx * halfThickness) - Math.abs(dx / length * halfThickness);
            const maxX = Math.max(p1.x, p2.x) + Math.abs(nx * halfThickness) + Math.abs(dx / length * halfThickness);
            const minZ = Math.min(p1.y, p2.y) - Math.abs(nz * halfThickness) - Math.abs(dz / length * halfThickness);
            const maxZ = Math.max(p1.y, p2.y) + Math.abs(nz * halfThickness) + Math.abs(dz / length * halfThickness);

            colliders.push(
                new THREE.Box3(
                    new THREE.Vector3(minX, 0, minZ),
                    new THREE.Vector3(maxX, wallHeight, maxZ)
                )
            );
        }

        console.log(
            `Created ${colliders.length} wall colliders from layout.json.`
        );
    } catch (error) {
        console.error("Could not load layout.json for collisions:", error);
    }
}

function canMoveTo(position) {
    const playerBox = new THREE.Box3(
        new THREE.Vector3(
            position.x - PLAYER_RADIUS,
            0.1,
            position.z - PLAYER_RADIUS
        ),
        new THREE.Vector3(
            position.x + PLAYER_RADIUS,
            2.0,
            position.z + PLAYER_RADIUS
        )
    );

    for (const wallBox of colliders) {
        if (playerBox.intersectsBox(wallBox)) {
            return false;
        }
    }

    return true;
}

// ----------------------------------------------------
// First-person movement
// ----------------------------------------------------
function updateFirstPerson(delta) {
    if (!fpControls.isLocked || mode !== "first-person") {
        return;
    }

    // A / D = turn left / right
    if (keys.left) {
        camera.rotation.y += TURN_SPEED * delta;
    }

    if (keys.right) {
        camera.rotation.y -= TURN_SPEED * delta;
    }

    // W / S = move forward / backward
    const direction = new THREE.Vector3();

    if (keys.forward) {
        direction.z -= 1;
    }

    if (keys.backward) {
        direction.z += 1;
    }

    if (direction.lengthSq() === 0) {
        return;
    }

    direction.normalize();

    const forward = new THREE.Vector3();

    camera.getWorldDirection(forward);

    forward.y = 0;

    if (forward.lengthSq() > 0) {
        forward.normalize();
    }

    const movement = new THREE.Vector3();

    movement.addScaledVector(
        forward,
        -direction.z * MOVE_SPEED * delta
    );

    const nextPosition = camera.position.clone();

    nextPosition.add(movement);

    nextPosition.y = EYE_HEIGHT;

    if (canMoveTo(nextPosition)) {
        camera.position.copy(nextPosition);
    }
}


// ----------------------------------------------------
// Camera modes
// ----------------------------------------------------

function setFirstPersonMode() {
    mode = "first-person";

    orbitControls.enabled = false;

    camera.position.y = EYE_HEIGHT;

    if (fpControls.isLocked === false) {
        clickOverlay.style.display = "flex";
    }
}

function setTopViewMode() {
    mode = "top";

    if (fpControls.isLocked) {
        fpControls.unlock();
    }

    clickOverlay.style.display = "none";
    orbitControls.enabled = false;

    camera.position.set(0, 22, 0);
    camera.lookAt(0, 0, 0);
}

function setOrbitMode() {
    mode = "orbit";

    if (fpControls.isLocked) {
        fpControls.unlock();
    }

    clickOverlay.style.display = "none";
    orbitControls.enabled = true;

    orbitControls.target.set(0, 1, 0);

    camera.position.set(
        12,
        12,
        12
    );

    orbitControls.update();
}

// ----------------------------------------------------
// Reset
// ----------------------------------------------------

function resetPosition() {
    camera.position.copy(spawnPosition);
    camera.position.y = EYE_HEIGHT;
}

// ----------------------------------------------------
// Resize
// ----------------------------------------------------

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );
});

// ----------------------------------------------------
// Animation
// ----------------------------------------------------

function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.05);

    updateFirstPerson(delta);

    if (orbitControls.enabled) {
        orbitControls.update();
    }

    renderer.render(scene, camera);
}

// ----------------------------------------------------
// Start
// ----------------------------------------------------

loadModel();
animate();





