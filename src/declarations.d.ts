declare module "pdfmake" {
  const pdfMake: {
    setUrlAccessPolicy(callback: (url: string) => boolean): void;
    addFonts(fonts: Record<string, unknown>): void;
    createPdf(docDefinition: unknown): {
      getBuffer(): Promise<Buffer>;
    };
  };

  export default pdfMake;
}
