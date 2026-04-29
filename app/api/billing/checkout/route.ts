import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Subscription checkout has been removed. Use lead credit top-ups instead.' },
    { status: 410 },
  )
}
