declare namespace Supabase {
  namespace ai {
    class Session {
      constructor(model: string);
      run(input: string, options?: {
        mean_pool?: boolean;
        normalize?: boolean;
      }): Promise<number[]>;
    }
  }
}
