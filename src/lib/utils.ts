import ago from 's-ago'

export function humanDate(created_at: number): string {
  const d = created_at * 1000
  if (d < Date.now() - 1000 * 60 * 60 * 60 /* 60 hours */)
    return new Date(d).toDateString().split(' ').slice(1).join(' ')
  return ago(new Date(d))
}
