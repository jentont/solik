import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { giftImportSchema, importGifts } from '../modules/gifts/catalog.js';
import { prisma } from '../lib/prisma.js';

// Usage: npm run import:gifts -- [path/to/gifts.json]   (default: ../../data/gifts.json)
const file = process.argv[2] ?? path.resolve(process.cwd(), '../../data/gifts.json');
const items = giftImportSchema.parse(JSON.parse(await readFile(file, 'utf8')));
console.log(await importGifts(items));
await prisma.$disconnect();
