import * as React from 'react'
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className='', ...props }, ref) {
  return <input ref={ref} className={`h-9 px-2 rounded border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900 ${className}`} {...props} />
})
export default Input
