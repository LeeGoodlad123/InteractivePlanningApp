import * as React from 'react'
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className='', ...props }, ref) {
  return <textarea ref={ref} className={`w-full rounded border border-zinc-300 p-2 focus:outline-none focus:ring-2 focus:ring-zinc-900 ${className}`} {...props} />
})
export default Textarea
