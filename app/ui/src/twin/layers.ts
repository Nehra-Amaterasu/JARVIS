/**
 * The layer chips over the Aankhen twin, and which layers start on.
 *
 * Aankhen senses through Wi-Fi alone: no radar, no camera, ever. The twin can still
 * draw an LD2450 radar wedge if an old room.json lists one, so that layer ('fov')
 * starts OFF and has no chip; the type keeps it only so such a file still loads.
 * Kept free of three.js so the list can be tested without a WebGL scene.
 */
import type { Layer } from './SpatialTwin'

export const LAYERS: { id: Layer; label: string }[] = [
  { id: 'walls', label: 'Walls' }, { id: 'house', label: 'House' }, { id: 'heat', label: 'Heat' },
  { id: 'fresnel', label: 'Wi-Fi zone' }, { id: 'trails', label: 'Trails' }, { id: 'labels', label: 'Labels' },
  { id: 'truth', label: 'Truth' }, { id: 'estimate', label: 'Belief' }, { id: 'zones', label: 'Zone map' },
]

export const DEFAULT_LAYERS: Record<Layer, boolean> = {
  walls: true, heat: true, fov: false, fresnel: true, trails: true, labels: true, truth: true, house: true,
  estimate: true, zones: true,
}
