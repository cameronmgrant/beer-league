import { readFile } from 'node:fs/promises'
import { readPhotoMetadata } from '../photos/metadata.js'

const [path] = process.argv.slice(2)
if (!path) {
  console.error('Usage: npm run photo:inspect -- <path to a photo>')
  process.exit(1)
}

const metadata = await readPhotoMetadata(await readFile(path))
console.log(JSON.stringify(metadata, null, 2))
