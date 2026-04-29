import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'CRM import is currently disabled. Use the CRM queue and export workflow instead.' },
    { status: 410 },
  )
}
