/** Map wiki/CDN image fields onto files in public/images. */
export function publicMediaPath(
  image: string,
  dir: 'artifacts' | 'slabs',
  value: string
): string {
  const file = image.split('/').pop()?.split('?')[0]
  if (file && /\.(png|webp|jpe?g)$/i.test(file)) {
    return `/images/${dir}/${file}`
  }
  const ext = image.endsWith('.webp') ? 'webp' : 'png'
  return `/images/${dir}/${value}.${ext}`
}
