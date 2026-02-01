export type IO = {
  readStdin: () => Promise<string>
  stdout: (text: string) => void
  stderr: (text: string) => void
}

export function defaultIO(): IO {
  return {
    readStdin: () =>
      new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        process.stdin.resume()
        process.stdin.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        process.stdin.on('error', reject)
      }),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text)
  }
}
