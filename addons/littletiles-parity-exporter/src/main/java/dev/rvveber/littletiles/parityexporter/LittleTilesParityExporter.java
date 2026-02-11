package dev.rvveber.littletiles.parityexporter;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartingEvent;

@Mod(LittleTilesParityExporter.MOD_ID)
public final class LittleTilesParityExporter {

    public static final String MOD_ID = "littletiles_parity_exporter";
    public static final Logger LOGGER = LogManager.getLogger(MOD_ID);

    public LittleTilesParityExporter(IEventBus modBus) {
        NeoForge.EVENT_BUS.addListener(this::onServerStarting);
    }

    private void onServerStarting(ServerStartingEvent event) {
        LtDebugExportCommand.register(event.getServer().getCommands().getDispatcher());
        LtTextureExportCommand.register(event.getServer().getCommands().getDispatcher());
        LOGGER.info("Registered /lt-debug-export command");
        LOGGER.info("Registered /lt-texture-export command");
    }
}
