export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export function imageMime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16 || bytes.length > MAX_IMAGE_BYTES) return null
  if ([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)) return 'image/png'
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg'
  if (String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP') return 'image/webp'
  return null
}
export function isChatGptFileUrl(value) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase()
    if (url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443')) return false
    return host==='files.oaiusercontent.com' || host.endsWith('.oaiusercontent.com') ||
      /^oais(?:dmntpr|dsorpr)[a-z0-9]*\.blob\.core\.windows\.net$/.test(host) ||
      /^oaisdmntpr[a-z0-9]*\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host)
  } catch { return false }
}
export async function readChatGptFile(file, fetcher = fetch) {
  if (!file?.file_id || !isChatGptFileUrl(file.download_url)) throw new Error('unsupported_file_source')
  const response = await fetcher(file.download_url, {redirect:'error',signal:AbortSignal.timeout(15000)})
  if (!response.ok || !response.body) throw new Error('file_download_failed')
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error('file_too_large')
  const reader=response.body.getReader(), chunks=[]
  let total=0
  try { while (true) { const {done,value}=await reader.read();if(done)break;total+=value.length
    if(total>MAX_IMAGE_BYTES) {await reader.cancel();throw new Error('file_too_large')}chunks.push(value) } }
  finally {reader.releaseLock()}
  const bytes=new Uint8Array(total);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  if(!imageMime(bytes))throw new Error('invalid_illustration')
  return bytes
}
