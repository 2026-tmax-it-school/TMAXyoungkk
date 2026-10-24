/** 코드 칸에 보일 글자(순수, ui/CodeCells가 쓴다). 링크를 붙여 넣어도 코드만, 대문자·영숫자, 최대 length자 */
export function codeCellChars(input: string, length: number): string[] {
  let s = input.trim();
  const slash = s.lastIndexOf('/j/');
  if (slash >= 0) s = s.slice(slash + 3);
  return [...s.toUpperCase().replace(/[^0-9A-Z]/g, '')].slice(0, length);
}
