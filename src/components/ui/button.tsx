import * as React from 'react'
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default'|'secondary'|'destructive'|'ghost', size?: 'sm'|'md' }
export const Button = React.forwardRef<HTMLButtonElement, Props>(function Button({ className='', variant='default', size='md', ...props }, ref) {
  const color = variant==='secondary' ? 'bg-white border text-zinc-800 hover:bg-zinc-50' :
               variant==='destructive' ? 'bg-red-600 text-white hover:bg-red-700' :
               variant==='ghost' ? 'bg-transparent hover:bg-zinc-100' :
               'bg-zinc-900 text-white hover:bg-zinc-800'
  const pad = size==='sm' ? 'h-8 px-2 text-xs' : 'h-9 px-3 text-sm'
  return <button ref={ref} className={`inline-flex items-center justify-center rounded-xl border ${pad} ${color} ${className}`} {...props} />
})
export default Button
