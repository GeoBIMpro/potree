const THREE = require('three');
const ClipMode = require('../materials/ClipMode');
const ClipVolume = require('./ClipVolume');
const PolygonClipVolume = require('./PolygonClipVolume');
const getMousePointCloudIntersection = require('./getMousePointCloudIntersection');
const removeEventListeners = require('../utils/removeEventListeners');

class ClippingTool extends THREE.EventDispatcher {
	constructor (viewer) {
		super();

		this.viewer = viewer;

		this.clipMode = ClipMode.HIGHLIGHT;
		this.maxPolygonVertices = 8;

		this.addEventListener('start_inserting_clipping_volume', e => {
			this.viewer.dispatchEvent({
				type: 'cancel_insertions'
			});
		});

		this.sceneMarker = new THREE.Scene();
		this.sceneVolume = new THREE.Scene();
		this.sceneVolume.name = 'scene_clip_volume';
		this.viewer.inputHandler.registerInteractiveScene(this.sceneVolume);

		this.onRemove = e => {
			this.sceneVolume.remove(e.volume);
		};

		this.onAdd = e => {
			this.sceneVolume.add(e.volume);
		};

		this.viewer.inputHandler.addEventListener('delete', e => {
			let volumes = e.selection.filter(e => (e instanceof ClipVolume));
			volumes.forEach(e => this.viewer.scene.removeClipVolume(e));
			let polyVolumes = e.selection.filter(e => (e instanceof PolygonClipVolume));
			polyVolumes.forEach(e => this.viewer.scene.removePolygonClipVolume(e));
		});
	}

	setScene (scene) {
		if (this.scene === scene) {
			return;
		}

		if (this.scene) {
			removeEventListeners(this.scene, 'clip_volume_added', this.onAdd);
			removeEventListeners(this.scene, 'clip_volume_removed', this.onRemove);
			removeEventListeners(this.scene, 'polygon_clip_volume_added', this.onAdd);
			removeEventListeners(this.scene, 'polygon_clip_volume_removed', this.onRemove);
		}

		this.scene = scene;

		this.scene.addEventListener('clip_volume_added', this.onAdd);
		this.scene.addEventListener('clip_volume_removed', this.onRemove);
		this.scene.addEventListener('polygon_clip_volume_added', this.onAdd);
		this.scene.addEventListener('polygon_clip_volume_removed', this.onRemove);
	}

	setClipMode (mode) {
		if (this.clipMode === mode) {
			return;
		}
		if (ClipMode.forCode(mode) === undefined) {
			return;
		}

		this.clipMode = mode;
		this.viewer.dispatchEvent({'type': 'clipper.clipMode_changed', 'viewer': this.viewer, 'mode': mode});
	}

	getClipMode () {
		// Note: We could simply use the clipMode but getClipMode suggests there is a
		//       setClipMode.
		return this.clipMode;
	}

	startInsertion (args = {}) {
		let type = args.type || null;

		if (!type) {
			return;
		}

		if (type === 'plane') {
			let clipVolume = new ClipVolume(this.viewer, args);

			this.dispatchEvent({'type': 'start_inserting_clipping_volume'});

			this.viewer.scene.addClipVolume(clipVolume);

			let cancel = {
				callback: null
			};

			let drag = e => {
				// TODO: unused: let camera = this.viewer.scene.getActiveCamera();

				let I = getMousePointCloudIntersection(
					e.drag.end,
					this.viewer.scene.getActiveCamera(),
					this.viewer.renderer,
					this.viewer.scene.pointclouds);

				if (I) {
					clipVolume.position.copy(I.location);
				}
			};

			let drop = e => {
				clipVolume.removeEventListener('drag', drag);
				clipVolume.removeEventListener('drop', drop);

				cancel.callback();

				clipVolume.dispatchEvent({'type': 'clip_volume_changed', 'volume': clipVolume});
			};

			cancel.callback = e => {
				clipVolume.removeEventListener('drag', drag);
				clipVolume.removeEventListener('drop', drop);
				this.viewer.removeEventListener('cancel_insertions', cancel.callback);
			};

			clipVolume.addEventListener('drag', drag);
			clipVolume.addEventListener('drop', drop);
			this.viewer.addEventListener('cancel_insertions', cancel.callback);

			this.viewer.inputHandler.startDragging(clipVolume);
		} else if (type === 'polygon') {
			let polyClipVol = new PolygonClipVolume(this.viewer.scene.getActiveCamera().clone());

			this.dispatchEvent({'type': 'start_inserting_clipping_volume'});

			// this.viewer.scene.addPolygonClipVolume(polyClipVol);
			this.sceneMarker.add(polyClipVol);

			let cancel = {
				callback: null
			};

			let insertionCallback = (e) => {
				if (e.button === THREE.MOUSE.LEFT) {
					if (polyClipVol.markers.length > 1) {
						polyClipVol.addEdge(polyClipVol.markers.length - 2, polyClipVol.markers.length - 1);
					}

					polyClipVol.addMarker();

					if (polyClipVol.markers.length > this.maxPolygonVertices) {
						cancel.callback();
					}

					this.viewer.inputHandler.startDragging(
						polyClipVol.markers[polyClipVol.markers.length - 1]);
				} else if (e.button === THREE.MOUSE.RIGHT) {
					cancel.callback();
				}
			};

			cancel.callback = e => {
				this.sceneMarker.remove(polyClipVol);
				if (polyClipVol.markers.length > 3) {
					polyClipVol.removeLastMarker();
					for (let i = 0; i < polyClipVol.markers.length; i++) {
						polyClipVol.markers[i].position.copy(polyClipVol.markersPosWorld[i]);
						polyClipVol.markers[i].visible = false;
						polyClipVol.remove(polyClipVol.edges[i]);
					}
					polyClipVol.edges = [];
					for (let i = 0; i < polyClipVol.markers.length - 1; i++) {
						polyClipVol.addEdge(i, i + 1);
					}
					polyClipVol.addEdge(polyClipVol.markers.length - 1, 0);
					polyClipVol.addExtrudedEdges();
					polyClipVol.initialized = true;
					this.viewer.scene.addPolygonClipVolume(polyClipVol);
				} else {
					this.viewer.scene.removePolygonClipVolume(polyClipVol);
				}

				this.viewer.renderer.domElement.removeEventListener('mouseup', insertionCallback, true);
				this.viewer.removeEventListener('cancel_insertions', cancel.callback);
				this.viewer.inputHandler.enabled = true;
			};

			this.viewer.addEventListener('cancel_insertions', cancel.callback);
			this.viewer.renderer.domElement.addEventListener('mouseup', insertionCallback, true);
			this.viewer.inputHandler.enabled = false;

			polyClipVol.addMarker();
			this.viewer.inputHandler.startDragging(
				polyClipVol.markers[polyClipVol.markers.length - 1]);
		}
	}

	update () {
	}
};

module.exports = ClippingTool;
