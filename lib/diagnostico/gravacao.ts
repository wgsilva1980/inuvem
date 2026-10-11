import { NuvemshopError } from "@/lib/nuvemshop/errors";
import type { Coupon, CouponInput } from "@/lib/nuvemshop/coupons";
import { pt, type Product, type ProductInput, type Variant, type VariantInput } from "@/lib/nuvemshop/types";

/**
 * Teste de gravação: confere, na loja de verdade, que o painel consegue ESCREVER (criar produto, mudar estoque, preço, nome e SEO, criar e mexer em cupom) e
 * apagar o que criou. Tudo acontece num produto de teste NÃO PUBLICADO e num cupom desativado, criados e apagados aqui; nenhum produto ou cupom seu é tocado.
 */
export type StatusPasso = "ok" | "falha" | "pulado";

export interface PassoGravacao {
  id: string;
  titulo: string;
  status: StatusPasso;
  mensagem: string;
  ms: number;
}

export interface SobraGravacao {
  tipo: "produto" | "cupom";
  id: number;
  /** Código do cupom ou nome do produto, para a pessoa achar no admin da loja. */
  nome: string;
  situacao: "ainda existe" | "desativado (não foi possível apagar)";
}

export interface ResultadoGravacao {
  passos: PassoGravacao[];
  sobras: SobraGravacao[];
  /** Tudo o que os passos testaram deu certo e nada ficou para trás. */
  tudoCerto: boolean;
  duracaoMs: number;
  produtoDeTesteId: number | null;
}

export interface ApiGravacao {
  criarProduto(input: ProductInput): Promise<Product>;
  lerProduto(id: number): Promise<Product>;
  alterarProduto(id: number, input: ProductInput): Promise<Product>;
  lerVariacao(productId: number, variantId: number): Promise<Variant>;
  alterarVariacao(productId: number, variantId: number, input: VariantInput): Promise<Variant>;
  apagarProduto(id: number): Promise<void>;
  criarCupom(input: CouponInput): Promise<Coupon>;
  alterarCupom(id: number, input: CouponInput): Promise<Coupon>;
  apagarCupom(id: number): Promise<void>;
}

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const aleatorio = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALFABETO[b % ALFABETO.length]).join("");
const carimbo = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const mesmo = (a: unknown, b: number) => num(a) !== null && Math.abs((num(a) as number) - b) < 0.005;
const erroTexto = (e: unknown) => (e instanceof NuvemshopError ? `${e.userMessage}${e.status ? ` [HTTP ${e.status}]` : ""}` : e instanceof Error ? e.message : String(e));

export async function executarTesteDeGravacao(api: ApiGravacao, opts: { agora?: () => number; budgetMs?: number; limiteMs?: number } = {}): Promise<ResultadoGravacao> {
  const agora = opts.agora ?? Date.now;
  const inicio = agora();
  const limite = inicio + (opts.budgetMs ?? 40_000);
  const ts = carimbo(new Date(inicio));
  const nome = `ZZ TESTE INUVEM ${ts} (pode apagar)`;
  const sku = `INUVEM-TESTE-${ts}`;
  const codigo = `INUVEMTESTE${aleatorio(6)}`;
  const passos: PassoGravacao[] = [];
  const sobras: SobraGravacao[] = [];
  let produtoId: number | null = null;
  let varId: number | null = null;
  let cupomId: number | null = null;

  async function passo(id: string, titulo: string, dependeProduto: boolean, f: () => Promise<string>): Promise<boolean> {
    const t0 = agora();
    if (dependeProduto && produtoId === null) {
      passos.push({ id, titulo, status: "pulado", mensagem: "Pulado: o produto de teste não foi criado.", ms: 0 });
      return false;
    }
    if (t0 >= limite) {
      passos.push({ id, titulo, status: "pulado", mensagem: "Pulado: acabou o tempo do teste (a limpeza roda mesmo assim).", ms: 0 });
      return false;
    }
    try {
      passos.push({ id, titulo, status: "ok", mensagem: await f(), ms: agora() - t0 });
      return true;
    } catch (e) {
      passos.push({ id, titulo, status: "falha", mensagem: erroTexto(e), ms: agora() - t0 });
      return false;
    }
  }
  const exige = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  await passo("criar-produto", "Criar um produto de teste (não publicado)", false, async () => {
    const p = await api.criarProduto({ name: { pt: nome }, published: false, variants: [{ sku, price: "9999.00", stock_management: true, stock: 1, weight: "0.1" }] });
    produtoId = typeof p.id === "number" ? p.id : null; // guarda antes de conferir, para a limpeza achar o produto mesmo se a resposta vier estranha
    const v = p.variants?.[0];
    varId = typeof v?.id === "number" ? v.id : null;
    exige(produtoId !== null, "a loja não devolveu o ID do produto criado");
    exige(varId !== null, "a loja não devolveu a variação do produto criado");
    exige(p.published === false, "o produto de teste veio publicado (deveria vir oculto)");
    exige(Number(v?.stock) === 1, `o estoque inicial veio ${String(v?.stock)} em vez de 1`);
    return `Produto ${produtoId} criado oculto, com 1 variação (estoque 1).`;
  });

  await passo("ler-produto", "Ler o produto de volta", true, async () => {
    const p = await api.lerProduto(produtoId!);
    exige(pt(p.name) === nome, "o nome lido não é o que foi gravado");
    exige(p.published === false, "o produto aparece publicado");
    return "Nome e situação conferem.";
  });

  await passo("estoque", "Mudar o estoque da variação", true, async () => {
    await api.alterarVariacao(produtoId!, varId!, { stock: 5 });
    const v = await api.lerVariacao(produtoId!, varId!);
    exige(Number(v.stock) === 5, `depois de gravar 5, a loja devolveu ${String(v.stock)}`);
    return "Estoque 1 → 5 conferido na leitura seguinte.";
  });

  await passo("preco", "Mudar preço e preço promocional", true, async () => {
    await api.alterarVariacao(produtoId!, varId!, { price: "9998.00", promotional_price: "9000.00" });
    const v = await api.lerVariacao(produtoId!, varId!);
    exige(mesmo(v.price, 9998), `o preço lido foi ${String(v.price)}, não 9998,00`);
    exige(mesmo(v.promotional_price, 9000), `o promocional lido foi ${String(v.promotional_price)}, não 9000,00`);
    return "Preço e promocional conferidos.";
  });

  await passo("produto", "Mudar nome e SEO do produto", true, async () => {
    const novo = `${nome} editado`;
    await api.alterarProduto(produtoId!, { name: { pt: novo }, seo_title: { pt: "Teste de gravação | INuvem" }, seo_description: { pt: "Produto de teste do painel INuvem; será apagado em seguida." } });
    const p = await api.lerProduto(produtoId!);
    exige(pt(p.name) === novo, "o nome lido não mudou");
    exige(pt(p.seo_title) === "Teste de gravação | INuvem", "o título de SEO lido não mudou");
    exige(pt(p.seo_description).startsWith("Produto de teste do painel INuvem"), "a descrição de SEO lida não mudou");
    return "Nome, título e descrição de SEO conferidos.";
  });

  await passo("cupom", "Criar um cupom desativado e alterá-lo", false, async () => {
    const c = await api.criarCupom({ code: codigo, type: "absolute", value: "1.00", valid: false, max_uses: 1 });
    cupomId = typeof c.id === "number" ? c.id : null;
    exige(cupomId !== null, "a loja não devolveu o ID do cupom");
    exige(c.code === codigo, `o código devolvido foi ${String(c.code)}`);
    exige(c.valid === false, "o cupom de teste veio ativo (deveria vir desativado)");
    const a = await api.alterarCupom(cupomId!, { value: "2.00", valid: false });
    exige(mesmo(a.value, 2), `depois de gravar 2,00, o cupom veio com ${String(a.value)}`);
    return `Cupom ${codigo} criado desativado e alterado.`;
  });

  // --- limpeza: roda sempre, com ou sem falhas acima ---
  if (cupomId !== null) {
    const id = cupomId;
    await passo("apagar-cupom", "Apagar o cupom de teste", false, async () => {
      try {
        await api.apagarCupom(id);
        return "Cupom apagado.";
      } catch (e) {
        // sem DELETE, deixa desativado (não dá desconto) e avisa onde está
        await api.alterarCupom(id, { valid: false }).catch(() => undefined);
        sobras.push({ tipo: "cupom", id, nome: codigo, situacao: "desativado (não foi possível apagar)" });
        throw new Error(`a loja não deixou apagar (${erroTexto(e)}); o cupom ${codigo} ficou desativado — apague em Descontos → Cupons.`);
      }
    });
  }
  if (produtoId !== null) {
    const id = produtoId;
    const t0 = agora();
    let apagado = false;
    let motivo = "";
    try {
      await api.apagarProduto(id);
    } catch (e) {
      motivo = erroTexto(e);
    }
    try {
      await api.lerProduto(id);
    } catch (e) {
      apagado = e instanceof NuvemshopError && e.status === 404;
      if (!apagado && !motivo) motivo = erroTexto(e);
    }
    if (apagado) passos.push({ id: "apagar-produto", titulo: "Apagar o produto de teste", status: "ok", mensagem: "Produto apagado e confirmado (a leitura devolve 404).", ms: agora() - t0 });
    else {
      sobras.push({ tipo: "produto", id, nome, situacao: "ainda existe" });
      passos.push({ id: "apagar-produto", titulo: "Apagar o produto de teste", status: "falha", mensagem: `${motivo || "o produto ainda existe depois de apagar"}. Apague “${nome}” em Produtos no admin da Nuvemshop.`, ms: agora() - t0 });
    }
  }

  const tudoCerto = passos.every((p) => p.status === "ok") && sobras.length === 0;
  return { passos, sobras, tudoCerto, duracaoMs: agora() - inicio, produtoDeTesteId: produtoId };
}

export function relatorioGravacaoTexto(r: ResultadoGravacao): string {
  const linhas = [`Teste de gravação — ${r.tudoCerto ? "tudo certo" : "COM PROBLEMAS"} (${Math.round(r.duracaoMs / 100) / 10} s)`, ""];
  for (const p of r.passos) linhas.push(`[${p.status.toUpperCase()}] ${p.titulo}: ${p.mensagem}`);
  if (r.sobras.length > 0) {
    linhas.push("", "FICOU PARA TRÁS NA LOJA (apague à mão):");
    for (const s of r.sobras) linhas.push(`- ${s.tipo} ${s.id} “${s.nome}” — ${s.situacao}`);
  }
  return linhas.join("\n");
}
