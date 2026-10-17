import type { ItineraryStore } from '../itineraries.mjs';
import type { SqlDb } from './postgres-store.mjs';

export function createPgItineraryStore(db: SqlDb): ItineraryStore;
