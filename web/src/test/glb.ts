import { WebIO, getBounds, type Document, type Node } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

/** Bytes of an asset imported with `?inline` (a base64 data URL). */
export function inlineBytes(dataUrl: string) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Parses a GLB the way the game will receive it, compression included. */
export async function readGlb(dataUrl: string): Promise<Document> {
  await MeshoptDecoder.ready
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  return io.readBinary(inlineBytes(dataUrl))
}

export function nodeNamed(document: Document, name: string): Node {
  const node = document.getRoot().listNodes().find((n) => n.getName() === name)
  if (!node) throw new Error(`Node "${name}" is missing; found: ${document.getRoot().listNodes().map((n) => n.getName()).join(', ')}`)
  return node
}

/** World-space bounding box of a node and its children, in metres. */
export const boundsOf = (document: Document, name: string) => getBounds(nodeNamed(document, name))

export const materialNames = (document: Document) => document.getRoot().listMaterials().map((m) => m.getName())
