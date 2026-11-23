import { getModelStatus } from '../../lib/model-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await getModelStatus(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
