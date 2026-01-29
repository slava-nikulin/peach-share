import { bootstrap, type Services } from './bootstrap';

let servicesPromise: Promise<Services> | undefined;

async function getRealBll() {
  if (!servicesPromise) servicesPromise = bootstrap();
  try {
    const { bll } = await servicesPromise;
    return bll;
  } catch (e) {
    // если упало — позволим повторить попытку следующим вызовом
    servicesPromise = undefined;
    throw e;
  }
}

/**
 * Синхронный фасад, который можно импортировать и использовать везде.
 * Методы возвращают Promise — это нормально, потому что операции и так async.
 */
export const BLL = {
  RoomService: {
    InitRoom: async (prs: string) => {
      const bll = await getRealBll();
      return bll.initRoom.run(prs);
    },

    // Exists: async (roomId: string) => {
    //   const bll = await getRealBll();
    //   // если у тебя roomExists — это репозиторий, лучше оформить отдельным usecase.
    //   // здесь предполагаю, что ты добавишь usecase `roomExists`.
    //   return bll.roomExists.execute(roomId);
    // },
  },
} as const;
