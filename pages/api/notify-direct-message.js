// Retired legacy endpoint: client-supplied recipients did not prove participation.
// Any future notification workflow must resolve recipients from a saved message.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method not allowed' })
  }
  return res.status(410).json({ error: 'Legacy email notifications are retired' })
}
