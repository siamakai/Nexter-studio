/**
 * LinkedIn post publisher with image support.
 * Handles the 2-step LinkedIn asset upload for image posts:
 *   1. Register upload → get upload URL + asset URN
 *   2. PUT binary → upload image
 *   3. Create UGC post referencing the asset URN
 */

const BASE         = 'https://api.linkedin.com/v2'
const ACCESS_TOKEN = process.env.LINKEDIN_ACCESS_TOKEN!
const PERSON_URN   = process.env.LINKEDIN_PERSON_URN!

interface PostResult {
  ok: boolean
  error?: string
}

async function uploadImageToLinkedIn(imageUrl: string): Promise<string | null> {
  if (!ACCESS_TOKEN || !PERSON_URN) return null
  try {
    // Step 1: Register upload
    const registerRes = await fetch(`${BASE}/assets?action=registerUpload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202401',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: PERSON_URN,
          serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
        },
      }),
    })
    if (!registerRes.ok) return null
    const registerData = await registerRes.json()
    const uploadUrl: string = registerData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl
    const assetUrn: string = registerData.value?.asset

    if (!uploadUrl || !assetUrn) return null

    // Step 2: Download image from DALL-E URL and upload to LinkedIn
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) return null
    const imgBuffer = await imgRes.arrayBuffer()

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'image/png',
      },
      body: imgBuffer,
    })
    if (!uploadRes.ok) return null

    return assetUrn
  } catch { return null }
}

export async function postToLinkedIn(text: string, imageUrl: string | null): Promise<PostResult> {
  if (!ACCESS_TOKEN) return { ok: false, error: 'LINKEDIN_ACCESS_TOKEN not configured' }
  if (!PERSON_URN)   return { ok: false, error: 'LINKEDIN_PERSON_URN not configured' }

  try {
    let mediaCategory = 'NONE'
    let media: unknown[] = []

    if (imageUrl) {
      const assetUrn = await uploadImageToLinkedIn(imageUrl)
      if (assetUrn) {
        mediaCategory = 'IMAGE'
        media = [{ status: 'READY', media: assetUrn }]
      }
      // Fall through to text-only post if upload fails
    }

    const body = {
      author: PERSON_URN,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: mediaCategory,
          ...(media.length ? { media } : {}),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }

    const res = await fetch(`${BASE}/ugcPosts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': '202401',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.json()
      return { ok: false, error: JSON.stringify(err) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
