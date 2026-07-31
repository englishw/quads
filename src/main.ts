import './styles.css';
import { mountGame } from './ui/app';
import { mountGallery } from './ui/gallery';

const root = document.querySelector<HTMLElement>('#app');
const dragLayer = document.querySelector<HTMLElement>('#drag-layer');

if (!root || !dragLayer) {
  throw new Error('Missing #app or #drag-layer element');
}

const params = new URLSearchParams(location.search);

if (params.has('gallery')) {
  mountGallery(root);
} else {
  const demo = Number(params.get('demo') ?? 0);
  mountGame(root, dragLayer, { demoMoves: Number.isFinite(demo) ? demo : 0 });
}
